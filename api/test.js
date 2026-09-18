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
	"/vertxxy-1/Xyro/main/custom-loader.lua": '-- Xyro loader\nlocal API = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main"\nlocal KEY = "stale-in-repo"\nprint("body")\n',
	"/vertxxy-1/Xyro/main/loadstring.lua": '-- the other loader\nlocal API = "whatever"\nlocal KEY = "whatever"\n',
	"/vertxxy-1/Xyro/main/version.txt": "0.8.11\n",
	"/vertxxy-1/Xyro/main/nametags.json": JSON.stringify({ options: { collapseFar: true }, tags: [{ label: "FOUNDER" }] }),
};
function repoFile(pathname) {
	if (pathname === "/vertxxy-1/Xyro/main/xyro.lua") return scriptTruncated ? "-- cut off\nreturn" : FAKE_SCRIPT;
	return REPO_FILES_BASE[pathname];
}

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

	console.log("\n" + pass + " passed, " + failures.length + " failed");
	process.exit(failures.length ? 1 : 0);
})();
