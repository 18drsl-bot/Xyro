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
const REPO_FILES = {
	"/vertxxy-1/Xyro/main/version.txt": "0.8.11\n",
	"/vertxxy-1/Xyro/main/nametags.json": JSON.stringify({ options: { collapseFar: true }, tags: [{ label: "FOUNDER" }] }),
};
function repoFile(pathname) {
	if (pathname === "/vertxxy-1/Xyro/main/xyro.lua") return scriptTruncated ? "-- cut off\nreturn" : FAKE_SCRIPT;
	return REPO_FILES[pathname];
}

global.fetch = async (url, init) => {
	const u = new URL(url);
	const method = (init && init.method) || "GET";
	calls.push({ url: u, method, body: init && init.body });
	if (u.hostname === "test-db.firebaseio.com") {
		if (dbDown) throw new TypeError("network error");
		if (dbDenied) return new Response('{"error":"Permission denied"}', { status: 401 });
		const p = u.pathname.replace(/^\//, "").replace(/\.json$/, "");
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
	ok("a denied read is NOT reported as 200", res.status === 502, "got " + res.status);
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
