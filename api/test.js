// api/test.js - exercise every route of api/worker.js against a mocked
// database and repo, so the Worker can be changed without deploying blind.
//   node api/test.js
//
// The Worker is an ES module, and this repo has no package.json (Cloudflare
// does not need one), so it is imported through a data: URL - no build step,
// no dependency, same file that gets deployed.
const fs = require("fs");
const path = require("path");

/* ------------------------------------------------------- mocked database */

let store = {};
const calls = [];
let dbDown = false; // simulate an unreachable database
let dbDenied = false; // simulate closed rules: HTTP 401 + {"error":"Permission denied"}
// the production shape of this database: anonymous READS are allowed, writes to
// `staff` are refused (that node holds the staff list, the blacklist and the
// kill switch). Writes to cmd/here stay open.
let denyStaffWrites = false;
// the Google token endpoint, for the service-account credential
let tokenCalls = 0;
let tokenDenied = false;

function segs(p) {
	return String(p).split("/").filter(s => s !== "");
}
function dbGet(p) {
	let node = store;
	for (const s of segs(p)) {
		if (node == null || typeof node !== "object") return null;
		node = node[s];
	}
	return node === undefined ? null : node;
}
function dbPut(p, value) {
	const parts = segs(p);
	let node = store;
	for (let i = 0; i < parts.length - 1; i++) {
		if (typeof node[parts[i]] !== "object" || node[parts[i]] === null) node[parts[i]] = {};
		node = node[parts[i]];
	}
	node[parts[parts.length - 1]] = value;
}
function dbDelete(p) {
	const parts = segs(p);
	let node = store;
	for (let i = 0; i < parts.length - 1; i++) {
		if (node == null || typeof node !== "object") return;
		node = node[parts[i]];
	}
	if (node && typeof node === "object") delete node[parts[parts.length - 1]];
}

// a synthetic stand-in for xyro.lua: long enough to clear the Worker's size guard,
// carrying the markers it looks for
const FAKE_SCRIPT = "-- xyro\n" + "H.Nametags = {}\nRenderStepped\n" + "x".repeat(120000) + "\nreturn\n";
let scriptTruncated = false;
// the loader template, with the two constants /loader rewrites
const REPO_FILES_BASE = {
	// the editor page: the Worker serves it with its API location injected
	"/vertxxy-1/Xyro/main/index.html": "<!doctype html>\n<html><head><title>Xyro Tag Editor</title></head><body><p>editor</p></body></html>\n",
	"/vertxxy-1/Xyro/main/custom-loader.lua": '-- Xyro loader\nlocal API = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main"\nlocal KEY = "stale-in-repo"\nprint("body")\n',
	"/vertxxy-1/Xyro/main/loadstring.lua": '-- the other loader\nlocal API = "whatever"\nlocal KEY = "whatever"\n',
	"/vertxxy-1/Xyro/main/version.txt": "0.8.11\n",
	// stand-in for a real seal: only its bytes and content type matter here
	"/vertxxy-1/Xyro/main/media/seal_founder.png": "\u0089PNG\r\nseal-pixels",
	"/vertxxy-1/Xyro/main/media/verified_seal_blue.png": "\u0089PNG\r\nverified-seal-pixels",
};
let emptyRepoFile = false; // simulate GitHub answering 200 with no body at all
function repoFile(pathname) {
	if (emptyRepoFile && pathname.endsWith("/nametags.json")) return "";
	if (pathname === "/vertxxy-1/Xyro/main/xyro.lua") return scriptTruncated ? "-- cut off\nreturn" : FAKE_SCRIPT;
	// the rules are mutable here: publishing through the API must change what
	// the next reader gets, and a corrupt file must be caught rather than served
	if (pathname === "/vertxxy-1/Xyro/main/nametags.json") return nametagsFixture;
	return REPO_FILES_BASE[pathname];
}

/* the nametag system: the rules the API hosts, plus the repo-side token path */
let nametagsFixture = JSON.stringify({ options: { collapseFar: true }, tags: [{ label: "FOUNDER" }] });
let githubSha = "sha-1";

/* A stand-in for the D1 binding, reproducing the ONE statement the Worker
 * issues: insert when the row is absent, update only when `rev` still matches.
 * A mock that ignored the WHERE would pass while the real thing clobbered a
 * newer revision - which is the entire point of the guard. */
function newDb(opts = {}) {
	const state = { body: null, rev: 0 };
	const statements = [];
	return {
		statements,
		body: () => state.body,
		rev: () => state.rev,
		set(body, rev) { state.body = body; state.rev = rev; },
		setRows(rows) { opts.rows = rows; },
		rows: () => opts.rows || [],
		writes: () => opts.writes || [],
		binding: {
			prepare(sql) {
				statements.push(sql);
				/* D1 puts first()/run() on the statement AND on the bound statement
				   (prepare(sql).first() is how a parameterless read is written), so
				   both shapes answer here */
				const statement = {
					async first() {
						if (opts.failRead) throw new Error("D1_ERROR: no such table: rules");
						return state.body == null ? null : { body: state.body, rev: state.rev };
					},
					async all() {
						if (opts.failRead) throw new Error("D1_ERROR: no such table: blacklist");
						return { results: opts.rows || [] };
					},
					async run() {
						if (opts.failRead) throw new Error("D1_ERROR: no such table: rules");
						/* The blacklist writes are APPLIED to opts.rows, not merely recorded.
						   The Worker reads the merged list back after an unblock so it can
						   report what the script will actually see, so a mock that ignored
						   the delete would make that read-back meaningless - and would let a
						   real "still blocked" regression pass as success. */
						if (/blacklist/i.test(sql)) {
							opts.writes = opts.writes || [];
							opts.writes.push({ sql, args });
							opts.rows = opts.rows || [];
							if (/^\s*DELETE/i.test(sql)) opts.rows = opts.rows.filter(r => r.who !== args[0]);
							else if (/^\s*INSERT/i.test(sql)) {
								opts.rows = opts.rows.filter(r => r.who !== args[0]);
								opts.rows.push({ who: args[0], reason: args[1] });
							}
							return { meta: { changes: 1 } };
						}
						const body = args[0];
						const expected = Number(args[args.length - 1]);
						if (state.body == null) { state.body = body; state.rev = 1; return { meta: { changes: 1 } }; }
						if (state.rev === expected) { state.body = body; state.rev += 1; return { meta: { changes: 1 } }; }
						return { meta: { changes: 0 } };
					},
				};
				let args = [];
				return Object.assign(Object.create(null), statement, {
					bind(...vals) { args = vals; return statement; },
				});
			},
		},
	};
}
let githubConflict = false; // simulate GitHub refusing a stale publish (409)
const githubPuts = [];

global.fetch = async (url, init) => {
	const u = new URL(url);
	const method = (init && init.method) || "GET";
	calls.push({ url: u, method, body: init && init.body });
	if (u.hostname === "test-db.firebaseio.com") {
		if (dbDown) throw new TypeError("network error");
		if (dbDenied) return new Response('{"error":"Permission denied"}', { status: 401 });
		const p = u.pathname.replace(/^\//, "").replace(/\.json$/, "");
		// the real rules: `staff` refuses anonymous writes, and lets an owner
		// through - which is what ?access_token= / ?auth= make a request
		const owner = /[?&]access_token=sa-token-/.test(u.search) || /[?&]auth=/.test(u.search);
		if (denyStaffWrites && !owner && (method === "PUT" || method === "DELETE") && p.split("/")[0] === "staff") {
			return new Response('{"error":"Permission denied"}', { status: 401 });
		}
		if (method === "PUT") {
			dbPut(p, JSON.parse(init.body));
			return new Response(init.body, { status: 200 });
		}
		if (method === "DELETE") {
			dbDelete(p);
			return new Response("null", { status: 200 });
		}
		const value = dbGet(p);
		return new Response(value === null ? "null" : JSON.stringify(value), { status: 200 });
	}
	if (u.hostname === "oauth2.googleapis.com") {
		tokenCalls++;
		if (tokenDenied) return new Response('{"error":"invalid_grant","error_description":"Invalid JWT"}', { status: 400 });
		return new Response(JSON.stringify({ access_token: "sa-token-" + tokenCalls, expires_in: 3600 }), { status: 200 });
	}
	if (u.hostname === "api.github.com") {
		const auth = (init && init.headers && (init.headers.authorization || init.headers.Authorization)) || "";
		if (auth === "Bearer bad-token") return new Response('{"message":"Bad credentials"}', { status: 401 });
		// GitHub sends x-oauth-scopes for a CLASSIC token and nothing for a
		// fine-grained one; the Worker tells the two apart from exactly this.
		if (auth === "Bearer classic-token") {
			const body = repoFile("/vertxxy-1/Xyro/main/nametags.json");
			return new Response(JSON.stringify({ sha: githubSha, content: Buffer.from(body, "utf8").toString("base64") }), {
				status: 200,
				headers: { "x-oauth-scopes": "repo, workflow, delete_repo, admin:org, admin:public_key, gist" },
			});
		}
			// GitHub does not inline content for files over 1 MB: content:"" +
		// encoding:"none". The Worker must fall back to raw for those, or serve
		// the 200-with-no-body that made the big tag images blank.
		if (auth === "Bearer big-file-token") {
			const bigName = decodeURIComponent(u.pathname.replace("/repos/vertxxy-1/Xyro/contents/", ""));
			return new Response(JSON.stringify({
				sha: "big-sha",
				size: 2257528,
				content: bigName === "media/verified_seal_blue.png" ? "" : "c29tZQ==",
				encoding: bigName === "media/verified_seal_blue.png" ? "none" : "base64",
			}), { status: 200 });
		}
		const name = decodeURIComponent(u.pathname.replace("/repos/vertxxy-1/Xyro/contents/", ""));
		if (method === "PUT") {
			if (githubConflict) return new Response('{"message":"nametags.json does not match " + "' + githubSha + '"}', { status: 409 });
			const payload = JSON.parse(init.body);
			githubPuts.push({ name, payload });
			if (name === "nametags.json") nametagsFixture = Buffer.from(payload.content, "base64").toString("utf8");
			/* an uploaded piece of artwork becomes part of the repo the next read
			   serves, so a GET after a PUT is a real round trip and not two mocks
			   agreeing with each other. latin1 keeps the bytes exact through a
			   string body, which is what the Worker's raw fallback reads back. */
			if (name.startsWith("media/")) {
				REPO_FILES_BASE["/vertxxy-1/Xyro/main/" + name] = Buffer.from(payload.content, "base64").toString("latin1");
			} else {
				/* githubSha is the RULES file's blob sha, and the publish tests depend
				   on it moving only when that file moves - an artwork commit is a
				   different blob */
				githubSha = "sha-" + (githubPuts.length + 1);
			}
			return new Response(JSON.stringify({ content: { sha: githubSha } }), { status: 200 });
		}
		const body = repoFile("/vertxxy-1/Xyro/main/" + name);
		if (body === undefined) return new Response('{"message":"Not Found"}', { status: 404 });
		return new Response(JSON.stringify({ sha: githubSha, content: Buffer.from(body, "utf8").toString("base64") }), { status: 200 });
	}
	if (u.hostname === "raw.githubusercontent.com") {
		const body = repoFile(u.pathname);
		if (body === undefined) return new Response("Not Found", { status: 404 });
		return new Response(body, { status: 200 });
	}
	throw new Error("unexpected fetch: " + url);
};

/* --------------------------------------------------------------- harness */

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
	if (cond) {
		pass++;
	} else {
		failures.push(name + (extra ? " -> " + extra : ""));
		console.log("FAIL " + name + (extra ? " -> " + extra : ""));
	}
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
	const src = fs.readFileSync(path.join(__dirname, "worker.js"), "utf8");
	const mod = await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
	const worker = mod.default;

	const BASE_ENV = { FB_URL: "https://test-db.firebaseio.com", RAW_REPO: "https://raw.githubusercontent.com/vertxxy-1/Xyro/main" };
	const tasks = [];
	function call(pathname, opts = {}) {
		const env = { ...BASE_ENV, ...(opts.env || {}) };
		const req = new Request("https://api.test" + pathname, {
			method: opts.method || "GET",
			headers: opts.headers,
			body: opts.body,
		});
		return worker.fetch(req, env, { waitUntil: p => tasks.push(p) });
	}
	const body = async res => {
		try {
			return JSON.parse(await res.text());
		} catch {
			return null;
		}
	};
	const now = () => Math.floor(Date.now() / 1000);

	/* --- health --------------------------------------------------------- */
	let res = await call("/health");
	let json = await body(res);
	ok("health 200", res.status === 200);
	ok("health reports reads open without a key", json.reads === "open", JSON.stringify(json.reads));
	ok("health fails writes closed without a key", /DISABLED/.test(json.writes), json.writes);
	ok("health fails admin writes closed without an admin key", /DISABLED/.test(json.admin_writes), json.admin_writes);
	ok("health reports the gate", json.gate && json.gate.enabled === true && json.gate.source === "default", JSON.stringify(json.gate));

	/* --- database-shaped reads ------------------------------------------ */
	store = { staff: { admins: ["8579040069"], ranks: { founder: ["8579040069"] } } };
	res = await call("/staff.json");
	json = await body(res);
	ok("GET /staff.json passes the node through", res.status === 200 && same(json, { admins: ["8579040069"], ranks: { founder: ["8579040069"] } }), JSON.stringify(json));

	store = { cmd: { [now() - 2 + "-42"]: '"1|A|kick:"', [now() - 5000 + "-43"]: '"1|A|kick:"', "junk-key": '"1|A|kick:"' } };
	res = await call("/cmd.json");
	json = await body(res);
	ok("GET /cmd.json returns only fresh entries", Object.keys(json).length === 1 && Object.keys(json)[0].startsWith(String(now() - 2)), JSON.stringify(json));
	await Promise.all(tasks.splice(0));
	const deletes = calls.filter(c => c.method === "DELETE" && c.url.pathname.includes("/cmd/"));
	ok("stale queue entries are pruned in the background", deletes.length === 2, deletes.map(d => d.url.pathname).join(", "));

	store = { here: { Alive: now(), Stale: now() - 9999 } };
	res = await call("/here.json");
	json = await body(res);
	ok("GET /here.json filters dead beats", same(json, { Alive: now() }) || (json.Alive && !json.Stale), JSON.stringify(json));

	/* --- writes --------------------------------------------------------- */
	calls.length = 0;
	res = await call("/cmd/" + now() + "-7.json", { method: "PUT", body: '"123|Someone|freeze:Other"' });
	ok("PUT /cmd without XYRO_KEY fails closed (503)", res.status === 503, "got " + res.status);

	res = await call("/cmd/" + now() + "-7.json", { method: "PUT", body: '"123|Someone|freeze:Other"', env: { XYRO_KEY: "sekret" } });
	ok("PUT /cmd with the wrong key is 403", res.status === 403, "got " + res.status);

	res = await call("/cmd/" + now() + "-7.json", { method: "PUT", body: "not a command", env: { XYRO_KEY: "sekret" }, headers: { "x-api-key": "sekret" } });
	ok("PUT /cmd rejects a non-command body", res.status === 400, "got " + res.status);

	const key = now() + "-7";
	res = await call("/cmd/" + key + ".json", { method: "PUT", body: '"123|Someone|freeze:Other"', headers: { "x-api-key": "sekret" }, env: { XYRO_KEY: "sekret" } });
	json = await body(res);
	const stored = calls.find(c => c.method === "PUT");
	ok("PUT /cmd stores the command as a JSON string", res.status === 200 && json.ok === true && stored.body === '"123|Someone|freeze:Other"', "status " + res.status + " body " + (stored && stored.body));

	res = await call("/here/Some_User.json", { method: "PUT", body: String(now()), headers: { "x-api-key": "sekret" }, env: { XYRO_KEY: "sekret" } });
	ok("PUT /here accepts unix seconds", res.status === 200 && dbGet("here/Some_User") === now(), "got " + res.status + " " + dbGet("here/Some_User"));

	res = await call("/here/Some_User.json", { method: "PUT", body: '"not-a-time"', headers: { "x-api-key": "sekret" }, env: { XYRO_KEY: "sekret" } });
	ok("PUT /here rejects a non-numeric beat", res.status === 400, "got " + res.status);

	res = await call("/here/bad%20name.json", { method: "PUT", body: String(now()), headers: { "x-api-key": "sekret" }, env: { XYRO_KEY: "sekret" } });
	ok("PUT /here rejects a path-unsafe key", res.status === 400, "got " + res.status);

	res = await call("/here/Some_User.json", { method: "DELETE", headers: { "x-api-key": "sekret" }, env: { XYRO_KEY: "sekret" } });
	ok("DELETE /here removes the beat", res.status === 200 && dbGet("here/Some_User") === null);

	/* --- the Worker must not be an open database proxy ------------------- */
	res = await call("/.json");
	ok("root database reads are refused", res.status === 404, "got " + res.status);
	res = await call("/secrets.json");
	ok("unknown nodes are refused", res.status === 404, "got " + res.status);

	/* --- read gating ---------------------------------------------------- */
	res = await call("/staff.json", { env: { XYRO_KEY: "sekret" } });
	ok("GET /staff.json without a key is 403 once XYRO_KEY is set", res.status === 403, "got " + res.status);
	res = await call("/staff.json?key=sekret", { env: { XYRO_KEY: "sekret" } });
	ok("GET /staff.json works with ?key= (game:HttpGet has no headers)", res.status === 200, "got " + res.status);
	res = await call("/staff.json", { env: { XYRO_KEY: "sekret" }, headers: { "x-api-key": "sekret" } });
	ok("GET /staff.json works with the x-api-key header", res.status === 200, "got " + res.status);

	/* --- the kill switch ------------------------------------------------ */
	store = {};
	res = await call("/gate");
	json = await body(res);
	ok("gate is enabled by default (missing node)", res.status === 200 && json.enabled === true && json.source === "default", JSON.stringify(json));

	store = { staff: { gate: { enabled: false, message: "maintenance, back in 5" } } };
	res = await call("/gate");
	json = await body(res);
	ok("gate reads a disabled state", json.enabled === false && json.message === "maintenance, back in 5", JSON.stringify(json));
	res = await call("/staff/gate.json");
	json = await body(res);
	ok("the script's database-shaped gate route agrees", json.enabled === false, JSON.stringify(json));
	res = await call("/health");
	json = await body(res);
	ok("health surfaces a disabled gate", json.gate.enabled === false, JSON.stringify(json.gate));

	// the gate is a write, so the CLIENT key must not be able to trip it
	store = {};
	const WITH_KEYS = { XYRO_KEY: "sekret", XYRO_ADMIN_KEY: "owner" };
	res = await call("/gate/off", { method: "POST", body: "nope", env: WITH_KEYS, headers: { "x-api-key": "sekret" } });
	ok("a client key cannot trip the kill switch", res.status === 403, "got " + res.status);
	res = await call("/gate/off", { method: "POST", body: "down for five minutes", env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("the admin key trips it", res.status === 200 && json.gate.enabled === false && dbGet("staff/gate").enabled === false, JSON.stringify(json));
	ok("the trip stores its message and who did it", dbGet("staff/gate").message === "down for five minutes" && dbGet("staff/gate").updated > 0, JSON.stringify(dbGet("staff/gate")));

	res = await call("/script", { env: WITH_KEYS, headers: { "x-api-key": "sekret" } });
	const offText = await res.text();
	ok("/script refuses while the gate is off", res.status === 403 && /down for five minutes/.test(offText), res.status + " " + offText.slice(0, 60));

	res = await call("/gate", { method: "POST", body: JSON.stringify({ warn: "restarting in 10 minutes" }), env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("a partial patch keeps the other gate fields", json.gate.enabled === false && json.gate.warn === "restarting in 10 minutes", JSON.stringify(json.gate));
	ok("the patch records who sent it", json.gate.by === "api", json.gate.by);

	res = await call("/gate", { method: "POST", body: JSON.stringify({ enabled: true }), env: WITH_KEYS, headers: { "x-api-key": "owner", "x-xyro-by": "discord:vert" } });
	json = await body(res);
	ok("/gate can re-enable and clear the message", json.gate.enabled === true && json.gate.message === "", JSON.stringify(json.gate));
	ok("the caller can be named", json.gate.by === "discord:vert", json.gate.by);

	res = await call("/script", { env: WITH_KEYS, headers: { "x-api-key": "sekret" } });
	const onText = await res.text();
	ok("/script serves the source once enabled", res.status === 200 && onText.length > 100000 && onText.includes("H.Nametags"), res.status + " " + onText.length);
	ok("/script reports its byte length", res.headers.get("x-xyro-bytes") === String(onText.length), res.headers.get("x-xyro-bytes"));
	scriptTruncated = true;
	res = await call("/script", { env: WITH_KEYS, headers: { "x-api-key": "sekret" } });
	json = await body(res);
	ok("/script refuses a truncated repo copy", res.status === 502 && /truncated/.test(json.error || ""), JSON.stringify(json));
	scriptTruncated = false;

	/* --- the loader your users are handed ------------------------------- */

	// it must NOT need a key: this is the line someone pastes before they have
	// anything, and a key in it is a secret you cannot rotate
	res = await call("/loader", { env: WITH_KEYS });
	let loaderSrc = await res.text();
	ok("GET /loader needs no key", res.status === 200, "got " + res.status);
	ok("/loader is served as text", /text\/plain/.test(res.headers.get("content-type") || ""), res.headers.get("content-type"));
	ok("/loader rewrites the API line to the origin it was fetched from", loaderSrc.includes('local API = "https://api.test"'), JSON.stringify(loaderSrc.split("\n").slice(1, 3)));
	ok("/loader injects the client key it is currently using", loaderSrc.includes('local KEY = "sekret"'), JSON.stringify(loaderSrc.split("\n").slice(1, 3)));
	ok("/loader keeps the rest of the file", loaderSrc.includes('print("body")') && !loaderSrc.includes("stale-in-repo"), loaderSrc);

	// a different file is one variable away, with no code change
	res = await call("/loader", { env: { ...WITH_KEYS, LOADER_FILE: "loadstring.lua" } });
	ok("LOADER_FILE picks which loader is handed out", (await res.text()).includes("the other loader"), "");

	// the gate cuts it off at the source, which no client-side check can promise
	res = await call("/gate/off", { method: "POST", body: "down for five minutes", env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	res = await call("/loader", { env: WITH_KEYS });
	const loaderOff = await res.text();
	ok("/loader is refused while the gate is off", res.status === 403 && /down for five minutes/.test(loaderOff), res.status + " " + loaderOff.slice(0, 40));
	res = await call("/gate/on", { method: "POST", env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	ok("/loader comes back when the gate re-opens", (await call("/loader", { env: WITH_KEYS })).status === 200, "");

	/* --- the gate's auto re-open window --------------------------------- */
	store = { staff: { gate: { enabled: false, message: "maintenance", until: now() + 300 } } };
	res = await call("/gate");
	json = await body(res);
	ok("a future `until` keeps the gate closed", json.enabled === false, JSON.stringify(json));
	ok("...and reports how long is left", json.reopens_in > 290 && json.reopens_in <= 300, String(json.reopens_in));
	res = await call("/");
	const windowPage = await res.text();
	ok("the status page shows the re-open window", windowPage.includes("Re-opens") && windowPage.includes("in 5m"), "");

	store = { staff: { gate: { enabled: false, message: "maintenance", until: now() - 5 } } };
	res = await call("/gate");
	json = await body(res);
	ok("a past `until` re-opens by itself", json.enabled === true && json.auto_reopened === true, JSON.stringify(json));
	ok("a stale message stops being shown once it expires", json.message === "", JSON.stringify(json.message));

	// writing a window through the API
	store = { staff: {} };
	res = await call("/gate", { method: "POST", body: JSON.stringify({ enabled: false, message: "brb", until: now() + 600 }), headers: { "x-api-key": "owner" }, env: WITH_KEYS });
	json = await body(res);
	ok("POST /gate stores an until window", json.gate.enabled === false && json.gate.until > now() && dbGet("staff/gate").until > now(), JSON.stringify(dbGet("staff/gate")));
	res = await call("/gate", { method: "POST", body: JSON.stringify({ enabled: true }), headers: { "x-api-key": "owner" }, env: WITH_KEYS });
	json = await body(res);
	ok("re-enabling clears the window", json.gate.until === 0 && dbGet("staff/gate").until === 0, JSON.stringify(dbGet("staff/gate")));

	res = await call("/gate/off?for=60", { method: "POST", body: "short window", env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("/gate/off?for= sets a window", json.gate.enabled === false && json.gate.reopens_in > 50 && json.gate.reopens_in <= 60, JSON.stringify(json.gate));

	// the owner key can read too (a tool holding only the admin key should not
	// need a second key just to see the state)
	res = await call("/staff.json", { env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	ok("the admin key can read what the client key can read", res.status === 200, "got " + res.status);
	res = await call("/staff.json", { env: WITH_KEYS, headers: { "x-api-key": "sekret" } });
	ok("the client key still reads", res.status === 200, "got " + res.status);

	store = {};

	/* --- the gate.js control CLI ---------------------------------------- */
	const gateCli = require("./gate.js");
	for (const [input, want] of [["10m", 600], ["1h30m", 5400], ["1h 30m", 5400], ["45s", 45], ["2", 120], ["1d", 86400], ["", 0], ["nonsense", 0]]) {
		ok(`CLI duration ${JSON.stringify(input)} -> ${want}`, gateCli.parseDuration(input) === want, String(gateCli.parseDuration(input)));
	}
	ok("CLI humanize", gateCli.humanize(570) === "9m 30s" && gateCli.humanize(5400) === "1h 30m", gateCli.humanize(570));

	/* --- friendly routes ------------------------------------------------ */
	store = { staff: { admins: ["1"], blacklist: { 12345: "ban evasion" } } };
	res = await call("/blacklist");
	json = await body(res);
	ok("GET /blacklist returns just the map", json.count === 1 && json.blacklist["12345"] === "ban evasion", JSON.stringify(json));

	res = await call("/blacklist/12345", { method: "POST", body: "ban evasion", headers: { "x-api-key": "sekret" }, env: WITH_KEYS });
	ok("POST /blacklist refuses the public client key", res.status === 403, "got " + res.status);

	res = await call("/blacklist/12345", { method: "POST", body: "ban evasion", headers: { "x-api-key": "owner" }, env: WITH_KEYS });
	json = await body(res);
	ok("POST /blacklist writes the reason with the admin key", res.status === 200 && json.action === "blocked" && dbGet("staff/blacklist/12345") === "ban evasion", JSON.stringify(dbGet("staff/blacklist")));

	res = await call("/blacklist/12345", { method: "DELETE", headers: { "x-api-key": "owner" }, env: WITH_KEYS });
	ok("DELETE /blacklist unblocks", res.status === 200 && dbGet("staff/blacklist/12345") === null, JSON.stringify(dbGet("staff/blacklist")));

	store = { here: { Alive: now(), Old: now() - 300 } };
	res = await call("/online");
	json = await body(res);
	ok("GET /online lists only fresh players", json.count === 1 && json.online[0] === "Alive" && json.beats.Alive === now(), JSON.stringify(json));
	res = await call("/online?window=500");
	json = await body(res);
	ok("GET /online honours ?window=", json.count === 2, JSON.stringify(json));

	res = await call("/version");
	ok("GET /version serves the repo file", (await res.text()).trim() === "0.8.11");
	res = await call("/config");
	ok("GET /config serves nametags.json", (await body(res)).tags.length === 1);
	ok("GET /config is JSON", /application\/json/.test(res.headers.get("content-type") || ""));
	calls.length = 0;
	await call("/config?fresh=1");
	const rawCall = calls.find(c => c.url.hostname === "raw.githubusercontent.com");
	ok("?fresh=1 bypasses every cache (cache-buster reaches raw)", /[?&]t=\d+/.test(rawCall.url.search), rawCall.url.href);

	/* --- the nametag system, hosted here --------------------------------- */
	nametagsFixture = JSON.stringify({ options: { height: 44 }, tags: [{ label: "FOUNDER" }, { label: "HR" }] });
	res = await call("/nametags");
	json = await body(res);
	ok("GET /nametags serves the published rules", res.status === 200 && json.tags.length === 2, JSON.stringify(json));
	ok("/nametags is JSON", /application\/json/.test(res.headers.get("content-type") || ""), res.headers.get("content-type"));
	res = await call("/nametags.json", { env: WITH_KEYS });
	ok("/nametags.json is the same file and needs no key", res.status === 200 && (await body(res)).tags.length === 2, "got " + res.status);
	res = await call("/config");
	ok("/config is still the same bytes", (await body(res)).tags.length === 2, "");

	// tag artwork: the half that used to ride jsDelivr's edge
	res = await call("/media/seal_founder.png");
	const sealBytes = new Uint8Array(await res.arrayBuffer());
	ok("GET /media/<file> serves a seal from this origin", res.status === 200 && /image\/png/.test(res.headers.get("content-type") || "") && sealBytes.length > 4, "status " + res.status + " type " + res.headers.get("content-type"));
	res = await call("/media/verified_seal_blue.png");
	ok("the verified badge is served too", res.status === 200 && /image\/png/.test(res.headers.get("content-type") || ""), "got " + res.status);
	res = await call("/media/nope.exe");
	ok("an unknown media extension is refused, not passed through", res.status === 404, "got " + res.status);
	res = await call("/media/missing_seal.png");
	ok("a missing media file is a 404, not a 502", res.status === 404, "got " + res.status);
	res = await call("/media/%2e%2e%2fworker.js");
	ok("a media name that is not one plain segment never reaches a repo path", res.status === 404, "got " + res.status);

	/* --- POST /media/<file>: uploads without a token in the browser --------- */
	/* The editor used to hold a GitHub personal access token for exactly this
	   one job (PUT bytes into media/), which put the widest credential in the
	   system in a browser field. The Worker already holds a token to mirror the
	   rules, so the upload moves here - and the SAME whole-image rule applies at
	   the door, because a stored error page is the badge bug with a commit. */
	const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
	const pngUpload = Buffer.concat([PNG_SIG, Buffer.from("pretend-pixels-here"), IEND]);
	/* a GIF is used for the round trip because its bytes are all ASCII, so what
	   the mock stores and what the Worker serves back can be compared exactly */
	const gifUpload = Buffer.from("GIF89a" + "0123456789abcdefghij" + "\x3b", "latin1");
	const UPLOAD = { "content-type": "image/png" };
	/* the key that can publish, plus the Worker's own repo token */
	const MEDIA_OWNER = { ...WITH_KEYS, GH_TOKEN: "gh-write-token" };

	res = await call("/media/upload_thing.png", { method: "POST", body: pngUpload, env: WITH_KEYS, headers: UPLOAD });
	ok("POST /media needs a key like any other write", res.status === 403, "got " + res.status);

	res = await call("/media/upload_thing.png", { method: "POST", body: pngUpload, env: WITH_KEYS, headers: { ...UPLOAD, "x-api-key": "owner" } });
	json = await body(res);
	ok("...and says which one when the Worker has no repo token of its own",
		res.status === 503 && /GH_TOKEN/.test((json.error || "") + (json.hint || "")), res.status + " " + JSON.stringify(json));

	const putsBeforeUpload = githubPuts.length;
	res = await call("/media/upload_thing.png", { method: "POST", body: pngUpload, env: MEDIA_OWNER, headers: { ...UPLOAD, "x-api-key": "owner" } });
	json = await body(res);
	ok("with the owner key and a repo token the artwork is committed",
		res.status === 200 && json.ok === true && json.stored === "committed" && json.url === "/media/upload_thing.png",
		res.status + " " + JSON.stringify(json));
	const uploadPut = githubPuts[githubPuts.length - 1];
	ok("...to media/<name>, not to the rules",
		githubPuts.length === putsBeforeUpload + 1 && uploadPut.name === "media/upload_thing.png",
		githubPuts.map(p => p.name).slice(putsBeforeUpload).join(", "));
	ok("...carrying the bytes that were sent",
		Buffer.from(uploadPut.payload.content, "base64").equals(pngUpload), "");

	res = await call("/media/upload_thing.png", { method: "POST", body: pngUpload, env: MEDIA_OWNER, headers: { ...UPLOAD, "x-api-key": "owner" } });
	json = await body(res);
	ok("uploading the same file twice is answered without a second commit",
		res.status === 200 && json.stored === "already", JSON.stringify(json));

	/* the door check: an error page and a half-downloaded file must never be
	   stored, because media/<name> is fetched and cached by URL in the game */
	for (const [label, payload] of [
		["an error page", Buffer.from('{"error":"no such repo file"}')],
		["a half-downloaded PNG", pngUpload.subarray(0, Math.floor(pngUpload.length / 2))],
		["an empty body", Buffer.alloc(0)],
	]) {
		const before = githubPuts.length;
		res = await call("/media/upload_bad.png", { method: "POST", body: payload, env: MEDIA_OWNER, headers: { ...UPLOAD, "x-api-key": "owner" } });
		json = await body(res);
		ok("POST /media refuses " + label + " instead of committing it",
			res.status === 400 && githubPuts.length === before, res.status + " " + JSON.stringify(json));
	}
	res = await call("/media/nope.exe", { method: "POST", body: pngUpload, env: MEDIA_OWNER, headers: { ...UPLOAD, "x-api-key": "owner" } });
	ok("an unknown extension is refused for uploads too", res.status === 400, "got " + res.status);
	res = await call("/media/huge.png", { method: "POST", body: pngUpload, env: MEDIA_OWNER, headers: { ...UPLOAD, "x-api-key": "owner", "content-length": String(4 * 1024 * 1024) } });
	json = await body(res);
	ok("an oversized upload is refused before it is read",
		res.status === 413 && /limit is 3072 KB/.test(json.error || ""), res.status + " " + JSON.stringify(json));

	/* the round trip: what was uploaded is what the game then downloads */
	res = await call("/media/uploaded.gif", { method: "POST", body: gifUpload, env: MEDIA_OWNER, headers: { "content-type": "image/gif", "x-api-key": "owner" } });
	ok("an upload is accepted", res.status === 200, res.status + " " + JSON.stringify(await body(res)));
	res = await call("/media/uploaded.gif?fresh=1");
	const servedBack = Buffer.from(await res.arrayBuffer());
	ok("...and the very same bytes come back from the media route the game uses",
		res.status === 200 && servedBack.equals(gifUpload), res.status + " " + servedBack.length + " bytes");

	/* --- the editor, served from this origin ----------------------------- */
	/* Same page as GitHub Pages, but at the API's origin: that is what removes
	   the cross-origin preflight from a publish and the ~10-minute page cache
	   that made a new build a Ctrl+Shift+R and a wait. */
	res = await call("/editor", { env: { XYRO_KEY: "client-key" } });
	let editorHTML = await res.text();
	ok("GET /editor serves the tag editor as HTML", res.status === 200 && /text\/html/.test(res.headers.get("content-type") || "") && /<title>Xyro Tag Editor<\/title>/.test(editorHTML), res.status + " " + res.headers.get("content-type"));
	ok("...cached for a minute, not GitHub Pages' ten", /max-age=60/.test(res.headers.get("cache-control") || ""), res.headers.get("cache-control"));
	ok("...with its own API location injected, so boot needs no api.json lookup",
		/window\.__XYRO_API=\{"url":"https:\/\/api\.test","key":"client-key"\}/.test(editorHTML),
		(editorHTML.match(/window\.__XYRO_API=[^<]*/) || ["none"])[0]);
	ok("...injected inside <head>, before anything renders", editorHTML.indexOf("__XYRO_API") < editorHTML.indexOf("</head>"), "");
	res = await call("/editor?fresh=1", { env: { XYRO_KEY: "client-key" } });
	ok("?fresh=1 on the editor is never cached", /no-store/.test(res.headers.get("cache-control") || ""), res.headers.get("cache-control"));

	res = await call("/api.json", { env: { XYRO_KEY: "client-key" } });
	const apiJson = await body(res);
	ok("GET /api.json points a page on this origin at this origin",
		res.status === 200 && apiJson && apiJson.api && apiJson.api.url === "https://api.test" && apiJson.api.key === "client-key",
		JSON.stringify(apiJson));
	ok("...and is not key-gated, because the page that reads it has no key yet",
		!(/forbidden/.test(JSON.stringify(apiJson))), JSON.stringify(apiJson));

	/* A cache entry is whatever was produced at the time, so one bad answer - or
	   one bug in decoding it - gets replayed to every client for the whole TTL
	   and survives the deploy that fixed it. Observed for real: the contents API
	   returned content:"" for files over 1MB, so three seals were cached as
	   0-byte 200s and kept serving empty after the fix shipped. */
	{
		const realFetch = globalThis.fetch;
		let upstream = 0;
		globalThis.fetch = (url, init) => { upstream++; return realFetch(url, init); };
		const before = calls.length;
		let puts = 0;
		globalThis.caches = {
			default: {
				match: async () => new Response(new Uint8Array(0), { headers: { "content-type": "image/png", "content-length": "0" } }),
				put: async () => { puts++; },
				delete: async () => {},
			},
		};
		res = await call("/media/seal_founder.png");
		const guarded = new Uint8Array(await res.arrayBuffer());
		ok("a 0-byte entry in the edge cache is ignored, not served", res.status === 200 && guarded.length > 4, guarded.length + " bytes served");
		ok("...and it is refetched from upstream and re-cached", calls.length > before && puts === 1, "upstream " + (calls.length - before) + ", puts " + puts);

		// ...while a healthy entry is still served straight from the cache
		globalThis.caches.default.match = async () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "image/png", "content-length": "4" } });
		const upstreamBefore = calls.length;
		res = await call("/media/seal_founder.png");
		const hit = new Uint8Array(await res.arrayBuffer());
		ok("a good cache entry is still served without touching upstream", hit.length === 4 && calls.length === upstreamBefore,
			hit.length + " bytes, upstream " + (calls.length - upstreamBefore));
		delete globalThis.caches;
		globalThis.fetch = realFetch;
	}

	// a corrupt rules file must be loud: a client that applies half of it draws
	// the wrong tags for everyone
	nametagsFixture = "{ this is not json";
	res = await call("/nametags?fresh=1");
	json = await body(res);
	ok("a corrupt nametags.json is a loud 502", res.status === 502 && /nametags\.json/.test(json.error || ""), res.status + " " + JSON.stringify(json));
	nametagsFixture = JSON.stringify({ options: { height: 44 }, tags: [{ label: "FOUNDER" }] });

	// Buster on EVERY upstream read, not only ?fresh=1: without it GitHub's own
	// edge answers with a few-minute-old copy, and this Worker would then cache
	// that - i.e. the rules would arrive stale on a cache miss too.
	calls.length = 0;
	await call("/nametags");
	const plainRaw = calls.find(c => c.url.hostname === "raw.githubusercontent.com");
	ok("a repo read is cache-busted even without ?fresh=1", !!plainRaw && /[?&]t=\d+/.test(plainRaw.url.search), plainRaw && plainRaw.url.href);

	/* --- publishing the nametags through the API ------------------------- */
	const OWNER = { ...WITH_KEYS, GH_TOKEN: "gh-write-token" };
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[]}' });
	ok("PUT /nametags fails closed with no owner key configured", res.status === 503, "got " + res.status);
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[]}', env: WITH_KEYS });
	ok("PUT /nametags without a key is refused", res.status === 403, "got " + res.status);
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[]}', env: WITH_KEYS, headers: { "x-api-key": "wrong" } });
	ok("PUT /nametags with the client key is still refused", res.status === 403, "got " + res.status);
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[]}', env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("PUT /nametags says exactly which secret is missing", res.status === 503 && /GH_TOKEN/.test(json.error || ""), res.status + " " + JSON.stringify(json));

	calls.length = 0;
	githubPuts.length = 0;
	res = await call("/nametags", {
		method: "PUT",
		body: JSON.stringify({ options: { height: 50 }, tags: [{ label: "HELLO" }] }),
		env: OWNER,
		headers: { "x-api-key": "owner" },
	});
	json = await body(res);
	ok("PUT /nametags commits and returns the new sha", res.status === 200 && json.ok === true && json.sha === "sha-2", res.status + " " + JSON.stringify(json));
	ok("the commit is readable in git", githubPuts.length === 1 && /nametags via the Xyro API/.test(githubPuts[0].payload.message), JSON.stringify(githubPuts.map(p => p.payload.message)));
	ok("the commit sends the current blob sha (no blind overwrite)", githubPuts[0].payload.sha === "sha-1", githubPuts[0].payload.sha);
	res = await call("/nametags");
	ok("the published rules are what the next reader gets", (await body(res)).tags[0].label === "HELLO", JSON.stringify(await body(await call("/nametags"))));

	res = await call("/nametags", { method: "PUT", body: '{"tags":[]}', env: OWNER, headers: { "x-api-key": "owner" } });
	ok("a payload with no options block is refused", res.status === 400, "got " + res.status);
	res = await call("/nametags", { method: "PUT", body: "not json", env: OWNER, headers: { "x-api-key": "owner" } });
	ok("a payload that is not JSON at all is refused", res.status === 400, "got " + res.status);
	githubConflict = true;
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[]}', env: OWNER, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("a publish against a moved file is a 409, not a silent clobber", res.status === 409 && /github 409/.test(json.error || ""), res.status + " " + JSON.stringify(json));
	githubConflict = false;

	// with a repo token the rules come from the never-cached contents API
	calls.length = 0;
	res = await call("/nametags?fresh=1", { env: { GH_TOKEN: "gh-read-token" } });
	const hosts = calls.map(c => c.url.hostname);
	ok("with GH_TOKEN the rules come from the GitHub API", hosts.includes("api.github.com") && !hosts.includes("raw.githubusercontent.com"), hosts.join(", "));
	ok("...and still parse as the rules", res.status === 200 && (await body(res)).tags[0].label === "HELLO", "got " + res.status);

	json = await body(await call("/health"));
	ok("health names the nametag routes", json.nametags && /\/nametags/.test(json.nametags.rules || "") && /\/media/.test(json.nametags.media || ""), JSON.stringify(json.nametags));
	ok("health says publishing is off without a repo token", /unavailable/.test(json.nametags.publish || ""), json.nametags.publish);
	json = await body(await call("/health", { env: { GH_TOKEN: "gh-read-token" } }));
	ok("health says publishing is on with one", /PUT \/nametags/.test(json.nametags.publish || ""), json.nametags.publish);

	/* --- big files: the contents API will not inline them, so raw must --- */
	calls.length = 0;
	res = await call("/media/verified_seal_blue.png", { env: { GH_TOKEN: "big-file-token" } });
	const bigBytes = new Uint8Array(await res.arrayBuffer());
	ok("a file too big for the contents API is read from raw instead of served empty", res.status === 200 && bigBytes.length > 0, res.status + " " + bigBytes.length + " bytes");
	ok("...and the text of that file is intact", new TextDecoder().decode(bigBytes).startsWith("\u0089PNG"), JSON.stringify(new TextDecoder().decode(bigBytes).slice(0, 12)));
	ok("...which means it really did go upstream a second time", calls.filter(c => c.url.hostname === "raw.githubusercontent.com").length === 1, calls.map(c => c.url.hostname).join(", "));
	calls.length = 0;
	res = await call("/media/seal_founder.png", { env: { GH_TOKEN: "big-file-token" } });
	ok("a small file still comes from the API (the cheap path)", res.status === 200 && calls.some(c => c.url.hostname === "api.github.com") && !calls.some(c => c.url.hostname === "raw.githubusercontent.com"), calls.map(c => c.url.hostname).join(", "));

	// an empty upstream body must be loud, never a 200 with nothing in it
	emptyRepoFile = true;
	res = await call("/nametags?fresh=1");
	json = await body(res);
	ok("an empty repo read is a 502, not a silently empty body", res.status === 502 && /came back empty/.test(json.error || ""), res.status + " " + JSON.stringify(json));
	emptyRepoFile = false;

	/* --- publishing from the editor: the sha, the check, the lesser key --- */

	/* the editor needs the blob sha to publish safely, and a browser can only
	   read a custom header when the response exposes it */
	res = await call("/nametags?fresh=1", { env: { GH_TOKEN: "gh-read-token" } });
	ok("a token-backed read carries the blob sha", !!res.headers.get("x-xyro-sha"), String(res.headers.get("x-xyro-sha")));
	ok("the sha header is readable cross-origin", /x-xyro-sha/.test(res.headers.get("access-control-expose-headers") || ""), res.headers.get("access-control-expose-headers"));
	res = await call("/nametags?fresh=1");
	ok("with no repo token there is simply no sha to send back", !res.headers.get("x-xyro-sha"), String(res.headers.get("x-xyro-sha")));

	// POST /nametags/check is the editor's "Save & test"
	res = await call("/nametags/check", { method: "POST", env: WITH_KEYS });
	ok("the publish check needs the owner key", res.status === 403, "got " + res.status);
	res = await call("/nametags/check", { method: "POST", env: { ...WITH_KEYS, XYRO_ADMIN_KEY: "" } });
	ok("and fails closed with no publish key configured", res.status === 503, "got " + res.status);
	res = await call("/nametags/check", { method: "POST", env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("it names what is missing instead of failing generically", res.status === 503 && json.reason === "no_store" && /GH_TOKEN/.test(json.error || "") && /database/.test(json.error || ""), res.status + " " + JSON.stringify(json));
	res = await call("/nametags/check", { method: "POST", env: OWNER, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("with everything in place it reports the current file sha", res.status === 200 && json.ok === true && json.sha === githubSha, res.status + " " + JSON.stringify(json));
	ok("a fine-grained token is reported as such, with no warning", json.token && json.token.kind === "fine-grained" && !json.warning, JSON.stringify(json.token));

	// a classic token: cannot be limited to one repo, so say so where a human reads it
	res = await call("/nametags/check", { method: "POST", env: { ...WITH_KEYS, GH_TOKEN: "classic-token" }, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("a classic token is identified", res.status === 200 && json.token && json.token.kind === "classic", JSON.stringify(json.token));
	ok("...naming the scopes that make it an account-wide risk", same(json.token.wide, ["workflow", "delete_repo", "admin:org", "admin:public_key"]), JSON.stringify(json.token.wide));
	ok("...without listing harmless ones as dangerous", !json.token.wide.includes("gist") && !json.token.wide.includes("repo"), JSON.stringify(json.token.wide));
	ok("and the warning says what a leak would cost", /CLASSIC/.test(json.warning || "") && /delete_repo/.test(json.warning || "") && /fine-grained/.test(json.warning || ""), json.warning);
	res = await call("/nametags/check", { method: "POST", env: OWNER, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("a fine-grained token gets no warning at all", !json.warning, JSON.stringify(json.warning));
	res = await call("/nametags/check", { method: "POST", env: { ...WITH_KEYS, GH_TOKEN: "bad-token" }, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("a token GitHub refuses is reported, not hidden", res.status === 502 && json.reason === "github" && /Contents: Read and write/.test(json.error || ""), res.status + " " + JSON.stringify(json));

	// a lesser key that can publish and nothing else
	const PUBLISHER = { XYRO_ADMIN_KEY: "owner", XYRO_PUBLISH_KEY: "publisher", GH_TOKEN: "gh-write-token" };
	githubPuts.length = 0;
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[]}', env: PUBLISHER, headers: { "x-api-key": "publisher" } });
	ok("XYRO_PUBLISH_KEY can publish", res.status === 200 && (await body(res)).ok === true, "got " + res.status);
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[]}', env: PUBLISHER, headers: { "x-api-key": "sekret" } });
	ok("...but the client key still cannot", res.status === 403, "got " + res.status);
	res = await call("/gate/off", { method: "POST", body: "nope", env: PUBLISHER, headers: { "x-api-key": "publisher" } });
	ok("and it cannot trip the kill switch", res.status === 403, "got " + res.status);
	json = await body(await call("/health", { env: PUBLISHER }));
	ok("health mentions the publish-only key", /publish-only key/.test(json.nametags.publish || ""), json.nametags.publish);

	/* ------------------------------------------------- the rules database
	 *
	 *  The point of the table is that publishing needs NO repo token, so what
	 *  matters here is that the guard survives the move. It is a compare-and-set
	 *  instead of a git blob sha: the mock below reproduces the SQL semantics
	 *  (insert when absent, update only when the revision still matches) because
	 *  a mock that ignores the WHERE would pass while the real thing clobbered
	 *  a newer revision.
	 */
	const NO_TOKEN = { ...WITH_KEYS }; // deliberately NO GH_TOKEN anywhere
	const db = newDb();
	const DB = { ...NO_TOKEN, xyro_tags: db.binding };
	res = await call("/health", { env: DB });
	json = await body(res);
	ok("health names the rules database as the store", /database/.test(json.nametags.store || ""), json.nametags.store);
	ok("...and says publishing needs no repo token", /no repo token needed/.test(json.nametags.publish || ""), json.nametags.publish);
	res = await call("/health", { env: NO_TOKEN });
	json = await body(res);
	ok("with neither a database nor a token, health says publishing is unavailable", /unavailable/.test(json.nametags.publish || ""), json.nametags.publish);
	// an empty table means "use the repo file", so nothing changes until a publish
	res = await call("/nametags?fresh=1", { env: DB });
	const seed = await res.text();
	ok("an empty rules table falls back to the repo file", res.status === 200 && seed === nametagsFixture && res.headers.get("x-xyro-sha") !== "d1-0", "sha " + res.headers.get("x-xyro-sha"));

	// the whole point: publish with the owner key and NO token at all
	githubPuts.length = 0;
	db.statements.length = 0;
	const published = JSON.stringify({ options: { size: 33 }, tags: [{ match: "dbuser", label: "FROM THE DATABASE" }] });
	res = await call("/nametags", { method: "PUT", body: published, env: DB, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("publishing with NO GH_TOKEN is accepted - the database is the store", res.status === 200 && json.ok === true, res.status + " " + JSON.stringify(json));
	ok("...and it reports the database, not a commit", json.store === "database" && /skipped/.test(json.repo_mirror || ""), JSON.stringify(json));
	ok("...having touched GitHub not once", githubPuts.length === 0, "github calls: " + githubPuts.length);
	ok("...and it hands back the new revision as the guard", json.sha === "d1-1", String(json.sha));
	const writes = db.statements.filter(s => /INSERT/.test(s));
	ok("the guard is a single compare-and-set, not a read then a write", writes.length === 1 && /WHERE rules\.rev = \?/.test(writes[0]), JSON.stringify(db.statements));

	res = await call("/nametags?fresh=1", { env: DB });
	ok("the next read serves the stored rules, not the repo file", (await res.text()) === published, "");
	ok("...carrying the revision", res.headers.get("x-xyro-sha") === "d1-1", res.headers.get("x-xyro-sha"));
	res = await call("/nametags", { env: DB });
	ok("the aliases agree", (await res.text()) === published, "");

	// a tab that still holds a GIT sha (it read before the table was used) has no
	// revision to send, so the Worker takes the current one - that must work,
	// otherwise the first publish from an old tab would be a false conflict
	db.set(published, 2);
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[{"label":"OLD TAB"}]}', env: DB, headers: { "x-api-key": "owner" } });
	ok("a publish whose guard is a git sha still lands, taking the current revision", res.status === 200, "got " + res.status);

	// now the guard, explicitly: read the revision, publish, then try the old one
	const revNow = db.rev();
	const good = await call("/nametags?sha=d1-" + revNow, { method: "PUT", body: '{"options":{},"tags":[{"label":"CURRENT"}]}', env: DB, headers: { "x-api-key": "owner" } });
	ok("a publish carrying the current revision lands", good.status === 200, "got " + good.status);
	const behind = await call("/nametags?sha=d1-" + revNow, { method: "PUT", body: '{"options":{},"tags":[{"label":"BEHIND"}]}', env: DB, headers: { "x-api-key": "owner" } });
	json = await body(behind);
	ok("a publish carrying a revision that has moved on is refused (409)", behind.status === 409, "got " + behind.status + " " + JSON.stringify(json));
	ok("...and the rules the newer publish wrote are untouched", JSON.parse(db.body()).tags[0].label === "CURRENT", db.body());

	/* A tab that loaded the rules from the REPO is holding a git blob sha, which
	   cannot be checked against the row revision at all. Once a revision exists
	   that tab read a different source than the one it would overwrite, so
	   treating its guard as "overwrite whatever is there" is how it clobbers
	   rules it never saw - the exact "it will not keep my changes" failure. The
	   repo-guard publish must be refused while a revision exists, and must keep
	   working when the store is still empty (that is the seed case, above). */
	const foreign = await call("/nametags?sha=0000000000000000000000000000000000000000", { method: "PUT", body: '{"options":{},"tags":[{"label":"FOREIGN"}]}', env: DB, headers: { "x-api-key": "owner" } });
	json = await body(foreign);
	ok("a publish carrying a repo (git) guard is refused once a revision exists", foreign.status === 409, "got " + foreign.status + " " + JSON.stringify(json));
	ok("...naming the revision to reload for", json.revision === db.rev() && new RegExp("revision " + db.rev() + "\\b").test(json.error || ""), JSON.stringify(json));
	ok("...and the live rules keep the newer publish's contents", JSON.parse(db.body()).tags[0].label === "CURRENT", db.body());

	// the editor's "Save & test", with no token anywhere in sight
	res = await call("/nametags/check", { method: "POST", env: DB, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("Save & test says it can publish, with no repo token", res.status === 200 && json.ok === true && json.store === "database", res.status + " " + JSON.stringify(json));
	ok("...and reports the token kind as none rather than unknown", json.token && json.token.kind === "none", JSON.stringify(json.token));

	// a binding that is not applied yet must not look healthy, and must not
	// take the tags down
	const broken = newDb({ failRead: true });
	res = await call("/nametags/check", { method: "POST", env: { ...NO_TOKEN, xyro_tags: broken.binding }, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("a database that does not answer is reported, with the table command", res.status === 502 && /schema\.sql/.test(json.error || ""), res.status + " " + JSON.stringify(json));
	res = await call("/nametags?fresh=1", { env: { ...NO_TOKEN, xyro_tags: broken.binding } });
	ok("...while reads still serve the repo copy", res.status === 200 && (await res.text()) === nametagsFixture, "got " + res.status);

	// validation happens before a single row is touched
	db.statements.length = 0;
	res = await call("/nametags", { method: "PUT", body: '{"tags":"nope"}', env: DB, headers: { "x-api-key": "owner" } });
	ok("a malformed publish never reaches the database", res.status === 400 && db.statements.length === 0, res.status + " " + db.statements.length);

	// an optional mirror keeps the repo copy current when a token happens to exist
	const withMirror = { ...DB, GH_TOKEN: "gh-write-token" };
	githubPuts.length = 0;
	res = await call("/nametags", { method: "PUT", body: '{"options":{},"tags":[{"label":"MIRRORED"}]}', env: withMirror, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("with a token set the repo is mirrored too", res.status === 200 && /committed/.test(json.repo_mirror || "") && githubPuts.length === 1, JSON.stringify(json.repo_mirror));
	json = await body(await call("/health", { env: withMirror }));
	ok("health says the mirror is on", /committed as well/.test(json.nametags.repo_mirror || ""), json.nametags.repo_mirror);

	/* ------------------------------------------- the blacklist, no credential
	 *
	 *  The staff node lives in Firebase and refuses anonymous writes, so blocking
	 *  someone used to need a service-account secret. But the script reads the
	 *  blacklist THROUGH this Worker, so the Worker can hold its own entries and
	 *  merge them into that read - which is what makes the blacklist editable by
	 *  someone who has only ever set the owner key. */
	const blDb = newDb();
	const BL = { ...NO_TOKEN, xyro_tags: blDb.binding };
	blDb.setRows([{ who: "fromconsole", reason: "blocked in the console" }]);

	res = await call("/blacklist", { env: BL, headers: { "x-api-key": "sekret" } });
	json = await body(res);
	ok("the list merges the database entries with the staff node", res.status === 200 && json.blacklist.fromconsole === "blocked in the console", JSON.stringify(json));

	const fbWritesBefore = calls.filter(c => c.method !== "GET" && c.url.hostname === "test-db.firebaseio.com").length;
	res = await call("/blacklist/griefer", { method: "POST", body: "ban evasion", env: BL, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("blocking works with NO database credential at all", res.status === 200 && json.ok === true, res.status + " " + JSON.stringify(json));
	ok("...storing it in the Worker own database", json.store === "worker database", JSON.stringify(json));
	ok("...and touching Firebase not once", calls.filter(c => c.method !== "GET" && c.url.hostname === "test-db.firebaseio.com").length === fbWritesBefore, "firebase writes: " + (calls.filter(c => c.method !== "GET" && c.url.hostname === "test-db.firebaseio.com").length - fbWritesBefore));
	ok("...via one upsert, so blocking twice is not an error", blDb.writes().length === 1 && /ON CONFLICT\(who\) DO UPDATE/.test(blDb.writes()[0].sql), JSON.stringify(blDb.writes()));

	/* the part that matters: the SCRIPT reads staff.json, so the merge has to
	   happen on that read or the block would never reach the game */
	blDb.setRows([{ who: "fromconsole", reason: "blocked in the console" }, { who: "griefer", reason: "ban evasion" }]);
	res = await call("/staff.json", { env: BL, headers: { "x-api-key": "sekret" } });
	json = await body(res);
	ok("the script sees it: staff.json carries the merged blacklist", json.blacklist && json.blacklist.griefer === "ban evasion", JSON.stringify(json.blacklist));
	ok("...alongside anything the staff node already had", json.blacklist.fromconsole === "blocked in the console", "");

	res = await call("/blacklist/griefer", { method: "DELETE", env: BL, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("unblocking deletes from the same store", res.status === 200 && json.action === "removed" && /DELETE FROM blacklist/.test(blDb.writes().slice(-1)[0].sql), JSON.stringify(json));

	/* An entry can live in BOTH places, and the Worker can only edit the staff
	   node with a credential it may not have. Deleting the row here then leaves
	   the account blacklisted either way, so answering "removed" would be a lie
	   the editor repeats - you would click Unblock, see "unblocked", and wonder
	   why they are still refused in game. Read back and say what is true. */
	store = { staff: { blacklist: { phantom: "blocked in the console" } } };
	blDb.setRows([{ who: "phantom", reason: "blocked in the console" }]);
	res = await call("/blacklist/phantom", { method: "DELETE", env: BL, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("an unblock the staff node would undo is not reported as removed",
		!json.ok && json.action === "still blocked", res.status + " " + JSON.stringify(json));
	ok("...and it names the copy that is still blocking them", /staff node/.test(json.error || ""), json.error);
	/* the row itself is gone, so the next attempt (with a credential) is a plain
	   delete of the one copy that is left */
	ok("...having still deleted its own row", blDb.rows().every(r => r.who !== "phantom"), JSON.stringify(blDb.rows()));
	/* and once the staff node no longer has it, the same call reports success */
	store = { staff: {} };
	res = await call("/blacklist/phantom", { method: "DELETE", env: BL, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("with only its own copy left, the same unblock reports success",
		json.ok === true && json.action === "removed", JSON.stringify(json));

	// the push key is not enough: blocking is an owner action
	res = await call("/blacklist/griefer", { method: "POST", body: "x", env: { ...BL, XYRO_PUBLISH_KEY: "publisher" }, headers: { "x-api-key": "publisher" } });
	ok("the publish-only key still cannot block", res.status === 403, "got " + res.status);

	// with a credential, keep the staff node in step - best effort only
	const mirrorWrites = calls.length;
	res = await call("/blacklist/griefer", { method: "POST", body: "ban evasion", env: { ...BL, FB_SECRET: "legacy-secret" }, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("with a credential the staff node is written too", res.status === 200 && /written to the staff node/.test(json.staff_node || ""), JSON.stringify(json.staff_node));
	ok("...and that write goes to the right path", calls.slice(mirrorWrites).some(c => /\/staff\/blacklist\/griefer\.json/.test(c.url.pathname) && c.method === "PUT"), calls.slice(mirrorWrites).map(c => c.method + " " + c.url.pathname).join(", "));

	/* no store of its own: the staff node is the only copy, so a Worker with no
	   credential must still refuse honestly */
	denyStaffWrites = true;
	res = await call("/blacklist/griefer", { method: "POST", body: "x", env: { ...NO_TOKEN, XYRO_ADMIN_KEY: "owner" }, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("with neither a database nor a credential it says what is missing", res.status === 403 && /FB_SERVICE_ACCOUNT/.test(json.error || ""), res.status + " " + JSON.stringify(json.errors));
	denyStaffWrites = false;

	/* --- failure modes -------------------------------------------------- */
	dbDenied = true;
	res = await call("/staff.json");
	json = await body(res);
	ok("a denied read is NOT reported as 200", res.status === 403, "got " + res.status);
	ok("a denied read reports the database's reason", /Permission denied/.test(json.error || ""), JSON.stringify(json));
	dbDenied = false;

	dbDown = true;
	res = await call("/cmd.json");
	json = await body(res);
	ok("an unreachable database is a 502, not an empty queue", res.status === 502 && /unreachable/.test(json.error || ""), JSON.stringify(json));
	dbDown = false;

	res = await call("/health", { env: { FB_URL: "" } });
	json = await body(res);
	ok("health reports a missing FB_URL", /missing/.test(json.database), json.database);
	res = await call("/staff.json", { env: { FB_URL: "" } });
	ok("no FB_URL is a 500 with an explanation", res.status === 500, "got " + res.status);

	/* --- the credential the kill switch needs ---------------------------- */

	// This database allows anonymous reads but refuses anonymous writes to
	// `staff`, which is where staff/gate lives. Every case below runs with that
	// shape on, because it is the one that shipped and did not work.
	const { generateKeyPairSync } = require("crypto");
	const { privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	const SA = { FB_SERVICE_ACCOUNT: JSON.stringify({ type: "service_account", client_email: "xyro@proj.iam.gserviceaccount.com", private_key: privateKey }) };
	const withKeys = { ...WITH_KEYS, ...SA };
	denyStaffWrites = true;
	store = { staff: { admins: ["8579040069"] } };
	tokenCalls = 0;
	tokenDenied = false;

	// no credential: the refusal has to name the fix, not just say "denied"
	res = await call("/gate/off", { method: "POST", body: "down", env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("an owner trip without a database credential is refused, not a 200", res.status === 403, "got " + res.status);
	ok("...and the error names FB_SERVICE_ACCOUNT", /FB_SERVICE_ACCOUNT/.test(json.error || ""), JSON.stringify(json));
	ok("...and nothing was written to the gate", dbGet("staff/gate") === null, JSON.stringify(dbGet("staff/gate")));
	ok("a refused gate write does not claim success", json.ok === undefined, JSON.stringify(json));

	// the same trip WITH a service account: it goes through, and it carries a token
	calls.length = 0;
	res = await call("/gate/off", { method: "POST", body: "down", env: withKeys, headers: { "x-api-key": "owner" } });
	json = await body(res);
	const gateCall = calls.find(c => c.method === "PUT" && c.url.pathname.includes("staff/gate"));
	ok("with a service account the trip succeeds", res.status === 200 && json.gate.enabled === false, res.status + " " + JSON.stringify(json));
	ok("the database saw a service-account access token", !!gateCall && /access_token=sa-token-/.test(gateCall.url.search), gateCall && gateCall.url.search);
	ok("the gate really was written", dbGet("staff/gate").enabled === false, JSON.stringify(dbGet("staff/gate")));
	ok("the token came from one exchange", tokenCalls === 1, String(tokenCalls));

	res = await call("/gate/on", { method: "POST", env: withKeys, headers: { "x-api-key": "owner" } });
	ok("a second trip reuses the cached token", res.status === 200 && tokenCalls === 1 && dbGet("staff/gate").enabled === true, tokenCalls + " " + res.status);

	res = await call("/blacklist/12345", { method: "POST", body: "ban evasion", env: withKeys, headers: { "x-api-key": "owner" } });
	ok("the blacklist writes with the same credential", res.status === 200 && dbGet("staff/blacklist/12345") === "ban evasion", res.status + " " + JSON.stringify(dbGet("staff/blacklist")));

	// a credential that is present but broken must not break reads
	const readKey = { "x-api-key": "sekret" };
	res = await call("/staff.json", { env: { ...WITH_KEYS, FB_SERVICE_ACCOUNT: "not json" }, headers: readKey });
	ok("a malformed service account leaves reads working", res.status === 200, "got " + res.status);
	res = await call("/health", { env: { ...WITH_KEYS, FB_SERVICE_ACCOUNT: "not json" } });
	json = await body(res);
	ok("health reports the credential problem", /not valid JSON/.test(json.database_auth_error || ""), JSON.stringify(json.database_auth_error));
	ok("health says which credential is in use, and flags a broken one", json.database_auth === "service account (unusable)", json.database_auth);
	res = await call("/health", { env: withKeys });
	json = await body(res);
	ok("a working service account reads as plain 'service account'", json.database_auth === "service account", json.database_auth);

	res = await call("/gate/off", { method: "POST", body: "down", env: WITH_KEYS, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("health's error does not leak into a refusal message", !/not valid JSON/.test(json.error || ""), JSON.stringify(json));

	// a key that will not import, and a token exchange that fails
	const BAD_SA = { FB_SERVICE_ACCOUNT: JSON.stringify({ client_email: "x@y.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n" }) };
	res = await call("/staff.json", { env: { ...WITH_KEYS, ...BAD_SA }, headers: readKey });
	ok("an unreadable private key still leaves reads working", res.status === 200, "got " + res.status);
	res = await call("/gate/off", { method: "POST", body: "down", env: { ...WITH_KEYS, ...BAD_SA }, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("an unreadable private key is reported as such", res.status === 403 && /private key could not be read/.test(json.error || ""), res.status + " " + JSON.stringify(json));

	// a different account, so this cannot be answered from the token cache
	const { privateKey: secondKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: { type: "spki", format: "pem" },
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
	});
	const SA_B = { FB_SERVICE_ACCOUNT: JSON.stringify({ client_email: "xyro-2@proj.iam.gserviceaccount.com", private_key: secondKey }) };
	const withKeysB = { ...WITH_KEYS, ...SA_B };
	tokenDenied = true;
	res = await call("/staff.json", { env: withKeysB, headers: readKey });
	ok("a refused token exchange still leaves reads working", res.status === 200, "got " + res.status);
	res = await call("/gate/off", { method: "POST", body: "down", env: withKeysB, headers: { "x-api-key": "owner" } });
	json = await body(res);
	ok("a refused token exchange is reported, not hidden", res.status === 403 && /Google refused the service account/.test(json.error || ""), res.status + " " + JSON.stringify(json));
	res = await call("/health", { env: withKeysB });
	json = await body(res);
	ok("health surfaces the token failure", /Google refused/.test(json.database_auth_error || ""), JSON.stringify(json.database_auth_error));
	tokenDenied = false;

	// the legacy database secret is still accepted, and takes precedence
	tokenCalls = 0;
	calls.length = 0;
	res = await call("/gate/off", { method: "POST", body: "down", env: { ...withKeys, FB_SECRET: "legacy" }, headers: { "x-api-key": "owner" } });
	const legacyCall = calls.find(c => c.method === "PUT" && c.url.pathname.includes("staff/gate"));
	ok("FB_SECRET wins when both are set", res.status === 200 && /auth=legacy/.test(legacyCall.url.search) && tokenCalls === 0, (legacyCall && legacyCall.url.search) + " tokens " + tokenCalls);
	res = await call("/health", { env: { ...withKeys, FB_SECRET: "legacy" } });
	json = await body(res);
	ok("health names the legacy secret", json.database_auth === "legacy database secret", json.database_auth);
	denyStaffWrites = false;
	store = {};

	/* --- the status page ------------------------------------------------- */
	store = { here: { Alive: now() } };
	res = await call("/");
	const page = await res.text();
	ok("GET / serves a human page, not JSON", res.status === 200 && /text\/html/.test(res.headers.get("content-type") || ""), res.headers.get("content-type"));
	ok("the status page says LIVE when everything is up", page.includes("LIVE") && page.includes("connected"), page.slice(0, 80));
	ok("it counts who is running the script", page.includes("Players running now") && page.includes(">1<"), "");
	ok("it shows the script version from the repo", page.includes("0.8.11"), "");
	ok("it refreshes itself", page.includes('http-equiv="refresh"'));
	res = await call("/status");
	ok("/status is the same page", /text\/html/.test(res.headers.get("content-type") || ""));
	ok("the status page points at the hosted tag rules", page.includes('href="/nametags"') && page.includes("/media/*"), "");
	res = await call("/", { env: { GH_TOKEN: "gh-read-token" } });
	const tokenPage = await res.text();
	ok("and says publishing runs through the API once GH_TOKEN is set", /through this API/.test(tokenPage), "");

	// the gate message is admin input: it must never become live markup
	store = { staff: { gate: { enabled: false, message: '<img src=x onerror=alert(1)>down', by: "probe" } } };
	res = await call("/");
	const offPage = await res.text();
	ok("a tripped gate shows DISABLED on the page", offPage.includes("DISABLED") && offPage.includes("switched off"), "");
	ok("the gate message is escaped, not rendered", offPage.includes("&lt;img src=x") && !offPage.includes("<img src=x"), "");
	ok("the page still answers 200 while disabled", res.status === 200, "got " + res.status);

	dbDown = true;
	res = await call("/");
	const degPage = await res.text();
	ok("an unreachable database reads DEGRADED, not a crash", res.status === 200 && degPage.includes("DEGRADED"), "got " + res.status);
	dbDown = false;
	store = {};
	res = await call("/health");
	ok("/health is still JSON for machines", /application\/json/.test(res.headers.get("content-type") || ""), res.headers.get("content-type"));

	/* --- CORS + routing -------------------------------------------------- */
	res = await call("/staff.json", { method: "OPTIONS" });
	ok("preflight is 204 with CORS", res.status === 204 && res.headers.get("access-control-allow-origin") === "*", "got " + res.status);
	res = await call("/nope");
	ok("unknown path is 404", res.status === 404);

	/* --- tag artwork, and the file that actually ships --------------------- */
	/* Three failures came out of one image: a rule embedded a 1.29 MB PNG as a
	   base64 data URI while the SAME file already sat in media/, which took the
	   rules document to 1.72 MB. Every client re-downloads that document every
	   refreshSeconds (15s default) and re-decodes it in Lua, so one embedded
	   background makes every tag in the server feel slow. Nothing in the suite
	   ever looked at the file that ships, which is why it survived a review.

	   These read the real nametags.json rather than a fixture, so the guard is
	   about what players actually receive. */
	const shippedPath = path.join(__dirname, "..", "nametags.json");
	const shippedRules = JSON.parse(fs.readFileSync(shippedPath, "utf8"));
	const inlined = [];
	const walkRules = (node, where) => {
		if (typeof node === "string") {
			if (/^data:[^,]*;base64,/i.test(node)) inlined.push(where + " = " + Math.round(node.length / 1024) + " KB");
			return;
		}
		if (node && typeof node === "object") for (const k of Object.keys(node)) walkRules(node[k], where + "." + k);
	};
	walkRules(shippedRules.tags, "tags");
	let biggestBytes = 0;
	const walkBytes = node => {
		if (typeof node === "string") {
			if (/^data:[^,]*;base64,/i.test(node)) biggestBytes = Math.max(biggestBytes, node.length);
			return;
		}
		if (node && typeof node === "object") for (const k of Object.keys(node)) walkBytes(node[k]);
	};
	walkBytes(shippedRules);
	ok("no rule embeds a large base64 image (embedding is re-downloaded by every player)",
		biggestBytes <= 32768, "biggest embedded value: " + biggestBytes + " bytes" + (inlined.length ? " - " + inlined.join(", ") : ""));
	const shippedBytes = fs.statSync(shippedPath).size;
	ok("the shipped rules stay small (fetched by every client every refresh)",
		shippedBytes <= 256 * 1024, shippedBytes + " bytes");
	ok("rule artwork is referenced by URL, not carried in the document",
		(shippedRules.tags || []).every(t => [t.image, t.bgImage].every(v => !v || !/^data:image\//i.test(v))),
		(shippedRules.tags || []).map(t => [t.image, t.bgImage].filter(v => /^data:image\//i.test(v || "")).length).join(","));
	/* and every media URL a rule names must be a file the repo actually has,
	   or the badge renders as nothing with no error anywhere */
	const named = new Set();
	for (const t of shippedRules.tags || []) {
		for (const v of [t.image, t.bgImage]) {
			const m = typeof v === "string" && v.match(/\/media\/([A-Za-z0-9_.-]+)$/);
			if (m) named.add(m[1]);
		}
	}
	const missing = [...named].filter(f => !fs.existsSync(path.join(__dirname, "..", "media", f)));
	ok("every media file the rules reference exists in the repo", missing.length === 0, missing.join(", "));

	/* HEAD on the artwork route: the editor asks "is this file already served?"
	   with no token, and that answer is what keeps it from embedding base64. */
	res = await call("/media/seal_founder.png", { method: "HEAD" });
	ok("HEAD /media answers without a body", res.status === 200 && (await res.text()) === "", res.status);
	ok("...and still carries the art's content type", /image\/png/.test(res.headers.get("content-type") || ""), res.headers.get("content-type"));
	res = await call("/media/nope.png", { method: "HEAD" });
	ok("HEAD /media of a missing file is a 404, not a silent ok", res.status === 404, res.status);

	console.log("\n" + pass + " passed, " + failures.length + " failed");
	process.exit(failures.length ? 1 : 0);
})();
