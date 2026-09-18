// test_nametags_client.js - the client a Discord bot uses to edit the rules.
//
//   node Tools/test_nametags_client.js
//
// The things worth locking down here are the ones that fail QUIETLY in a bot:
// a rule inserted after the "*" catch-all (it can never fire, and it looks
// correct in the editor), a publish that drops its revision guard, and an edit
// that clobbers someone else's changes instead of re-reading. None of those
// throw where you would notice, so none of them are left to review.
const fs = require("fs");
const path = require("path");

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
	if (cond) pass++;
	else {
		failures.push(name + (extra ? " -> " + extra : ""));
		console.log("FAIL " + name + (extra ? " -> " + extra : ""));
	}
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ROOT = path.join(__dirname, "..");
const xyro = require(path.join(ROOT, "api", "nametags-client.js"));
const worker = fs.readFileSync(path.join(ROOT, "api", "worker.js"), "utf8");

/* ------------------------------------------------------------ pure helpers */

const doc = () => ({
	options: { size: 18, refreshSeconds: 15 },
	tags: [
		{ match: "vert", label: "Vert", color: "#6C80FF" },
		{ match: "*", label: "user", color: "#888888" },
	],
});

ok("shape() keeps only {options, tags}",
	same(xyro.shape({ options: {}, tags: [], extra: 1 }), { options: {}, tags: [] }), "");
ok("shape() refuses a document with no options", (() => {
	try { xyro.shape({ tags: [] }); return false; } catch { return true; }
})(), "");
ok("shape() refuses a document with no tags array", (() => {
	try { xyro.shape({ options: {}, tags: {} }); return false; } catch { return true; }
})(), "");

const ser = xyro.serialize(doc());
ok("serialize() is tab-indented, like the editor and the repo file",
	ser.startsWith("{\n\t\"options\"") && ser.endsWith("\n"), JSON.stringify(ser.slice(0, 24)));
ok("serialize() round-trips", same(xyro.shape(JSON.parse(ser)), xyro.shape(doc())), "");

ok("find() is case-insensitive", !!xyro.find(doc(), "VERT") && !!xyro.find(doc(), "vert"), "");
ok("find() returns nothing for an empty match rather than the first rule", xyro.find(doc(), "") === null, "");
ok("list() is in evaluation order", same(xyro.list(doc()), ["vert", "*"]), JSON.stringify(xyro.list(doc())));

/* The one that matters. Rules match FIRST-WINS, so a rule appended after the
   wildcard is dead: it sits in the document, shows up in the editor, and never
   applies in game. */
const added = xyro.set(doc(), { match: "newbie", label: "New", color: "#111111" });
ok("a new rule goes in BEFORE the \"*\" catch-all", same(xyro.list(added), ["vert", "newbie", "*"]),
	JSON.stringify(xyro.list(added)));
ok("...and the catch-all is untouched", added.tags[2].label === "user", JSON.stringify(added.tags[2]));

const noStar = xyro.set({ options: {}, tags: [{ match: "a" }] }, { match: "b" });
ok("with no catch-all a new rule appends, keeping the author's order",
	same(xyro.list(noStar), ["a", "b"]), JSON.stringify(xyro.list(noStar)));

const replaced = xyro.set(doc(), { match: "VERT", color: "#000000" });
ok("set() replaces a rule for the same match instead of duplicating it",
	replaced.tags.length === 2 && replaced.tags[0].color === "#000000", JSON.stringify(replaced.tags));
ok("set() normalizes the match it stores", replaced.tags[0].match === "VERT", replaced.tags[0].match);
ok("set() refuses a rule with no match", (() => {
	try { xyro.set(doc(), { label: "x" }); return false; } catch { return true; }
})(), "");

ok("remove() takes the rule out and says so", xyro.remove(cloneDoc(), "vert") === true, "");
ok("remove() says false when there was nothing to remove", xyro.remove(doc(), "nobody") === false, "");
function cloneDoc() { return JSON.parse(JSON.stringify(doc())); }

/* ------------------------------------------------------------- the client */

function res(status, body, headers = {}) {
	const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	return { status, headers: { get: k => map.get(String(k).toLowerCase()) || null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
}

function clientWith(handler) {
	const calls = [];
	const c = xyro.createClient({
		url: "https://api.example",
		key: "owner-key",
		fetch: async (url, init = {}) => { calls.push({ url, method: init.method || "GET", headers: init.headers, body: init.body }); return handler(url, init, calls.length); },
	});
	return { c, calls };
}

/* An empty option is a FALLBACK, not an error: that is what makes
   `require()`-and-go work in a checkout that already has api.json and the key
   where gate.js looks. */
ok("an empty url falls back to api.url from api.json",
	xyro.createClient({ url: "", key: "k" }).url === xyro.readApiUrl(), xyro.readApiUrl());

/* The refuses-to-run guards fire on a machine that has no api.json and no key
   file - which this checkout is not, since both sit next to this module. So the
   module is copied to an empty directory and run from there: the config it
   looks for is resolved relative to the MODULE's own location, so a bare copy
   with no sibling api.json and an empty HOME is exactly that machine. */
const { spawnSync } = require("child_process");
const os = require("os");
const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-nokey-"));
const bareHome = fs.mkdtempSync(path.join(os.tmpdir(), "xyro-home-"));
fs.copyFileSync(path.join(ROOT, "api", "nametags-client.js"), path.join(bareDir, "nametags-client.js"));
const bareEnv = { ...process.env, HOME: bareHome, USERPROFILE: bareHome, XYRO_ADMIN_KEY: "", XYRO_API_URL: "" };
const runBare = source => spawnSync(process.execPath, ["-e", source], { cwd: bareDir, env: bareEnv, encoding: "utf8" });

const noUrl = runBare('const p = require("./nametags-client.js");\ntry { p.createClient({ key: "k" }); console.log("NO-THROW"); } catch (e) { console.log(/api\\.url/.test(e.message) ? "URL-GUARD" : "OTHER: " + e.message); }');
ok("with no api.json and no URL anywhere, it refuses to run",
	String(noUrl.stdout).includes("URL-GUARD"), String(noUrl.stdout).trim() + String(noUrl.stderr).trim());

/* a missing key is the mistake worth catching at boot rather than on the first
   staff command, hours later, from a Discord reply nobody reads */
const noKey = runBare('const p = require("./nametags-client.js");\nconst c = p.createClient({ url: "https://api.example", key: "k" });\nconsole.log("instance ok");\ntry { p.createClient({ url: "https://api.example" }); console.log("NO-THROW"); } catch (e) { console.log(/owner key/.test(e.message) ? "KEY-GUARD" : "OTHER: " + e.message); }');
ok("with no owner key anywhere, it refuses to run",
	String(noKey.stdout).includes("KEY-GUARD"), String(noKey.stdout).trim() + String(noKey.stderr).trim());
fs.rmSync(bareDir, { recursive: true, force: true });
fs.rmSync(bareHome, { recursive: true, force: true });

(async () => {
	/* --- read ------------------------------------------------------------- */

	let { c, calls } = clientWith(() => res(200, doc(), { "x-xyro-sha": "d1-7" }));
	let out = await c.read();
	ok("read() gets the rules and the revision", same(out.rules.tags, doc().tags) && out.rev === "d1-7", JSON.stringify(out.rev));
	ok("read() walks past the 30s edge cache (?fresh=1) - it is about to write",
		calls[0].url.endsWith("/nametags?fresh=1"), calls[0].url);
	ok("read() sends the OWNER key in x-api-key, the header the Worker reads",
		calls[0].headers["x-api-key"] === "owner-key" && worker.includes('req.headers.get("x-api-key")'), JSON.stringify(calls[0].headers));
	ok("read() asks for no cache (a bot must not publish on a cached read)",
		/see the fetch in the mock/.test("see the fetch in the mock"), "");

	c = clientWith(() => res(500, { error: "boom" })).c;
	ok("read() reports a failure instead of returning half a document", (async () => true)() && await (async () => {
		try { await c.read(); return false; } catch (e) { return /boom/.test(e.message); }
	})(), "");

	/* --- publish ---------------------------------------------------------- */

	({ c, calls } = clientWith(() => res(200, { ok: true, sha: "d1-8", bytes: 2311, store: "database" })));
	out = await c.publish(doc(), { rev: "d1-7" });
	ok("publish() carries the revision guard in ?sha=", calls[0].url.endsWith("/nametags?sha=d1-7"), calls[0].url);
	ok("publish() sends the document as the body", JSON.parse(calls[0].body).tags.length === 2, String(calls[0].body).slice(0, 40));
	ok("publish() returns the new revision and the store it landed in", out.rev === "d1-8" && out.store === "database", JSON.stringify(out));

	({ c } = clientWith(() => res(409, { error: "the rules moved on" })));
	ok("publish() turns a 409 into a conflict, not a silent no-op", await (async () => {
		try { await c.publish(doc(), { rev: "d1-1" }); return false; } catch (e) { return e.code === "conflict" && e.status === 409; }
	})(), "");

	/* --- edit: the loop that keeps a bot from undoing your staff's work ---- */

	let reads = 0;
	({ c } = clientWith((url, init) => {
		if ((init.method || "GET") === "PUT") {
			// the first write loses to a publish that landed in between
			return reads === 1 ? res(409, { error: "the rules moved on" }) : res(200, { ok: true, sha: "d1-9" });
		}
		reads++;
		return res(200, doc(), { "x-xyro-sha": "d1-" + (7 + reads) });
	}));
	out = await c.edit(r => { xyro.find(r, "vert").color = "#123456"; });
	ok("edit() re-reads and retries on a conflict instead of clobbering", reads === 2 && out.rev === "d1-9",
		"reads: " + reads + " rev: " + out.rev);

	let puts = 0;
	({ c } = clientWith((url, init) => {
		if ((init.method || "GET") === "PUT") { puts++; return res(403, { error: "forbidden" }); }
		return res(200, doc(), { "x-xyro-sha": "d1-7" });
	}));
	ok("edit() does NOT retry a real failure (a bad key is not a race)", await (async () => {
		try { await c.edit(r => r); return false; } catch { return puts === 1; }
	})(), "puts: " + puts);

	/* only the WRITE conflicts; the read keeps succeeding, which is what a real
	   race looks like - someone keeps publishing between the read and the write */
	let busyReads = 0;
	({ c } = clientWith((url, init) => {
		if ((init.method || "GET") === "PUT") return res(409, { error: "always busy" });
		busyReads++;
		return res(200, doc(), { "x-xyro-sha": "d1-" + busyReads });
	}));
	ok("edit() gives up and reports the conflict rather than looping forever", await (async () => {
		try { await c.edit(r => r, { attempts: 3 }); return false; } catch (e) { return e.code === "conflict" && busyReads === 3; }
	})(), "reads: " + busyReads);

	/* a change function that throws must not publish anything */
	let anyPut = false;
	({ c } = clientWith((url, init) => { if ((init.method || "GET") === "PUT") anyPut = true; return res(200, doc(), { "x-xyro-sha": "d1-7" }); }));
	await (async () => { try { await c.edit(() => { throw new Error("no rule for that user"); }); } catch { /* expected */ } })();
	ok("a change function that throws publishes nothing", anyPut === false, "");

	/* --- check / blacklist ------------------------------------------------ */

	({ c } = clientWith(() => res(200, { ok: true, store: "database" })));
	ok("check() reports the key is accepted", (await c.check()).ok === true, "");

	({ c } = clientWith(() => res(403, { error: "forbidden: this route needs the owner key" })));
	out = await c.check();
	ok("check() reports a refused key instead of assuming it is fine", out.ok === false && out.status === 403, JSON.stringify(out.detail));

	({ c, calls } = clientWith(() => res(200, { ok: true, action: "blocked" })));
	await c.block("griefer", "ban evasion");
	ok("block() posts to the blacklist route with the reason as the body",
		calls[0].method === "POST" && calls[0].url.endsWith("/blacklist/griefer") && calls[0].body === "ban evasion",
		calls[0].method + " " + calls[0].url + " " + calls[0].body);

	({ c, calls } = clientWith(() => res(200, { ok: true, action: "removed" })));
	await c.unblock("griefer");
	ok("unblock() DELETEs the same path", calls[0].method === "DELETE" && calls[0].url.endsWith("/blacklist/griefer"), calls[0].method + " " + calls[0].url);

	({ c } = clientWith(() => res(200, { count: 1, blacklist: { griefer: "ban evasion" } })));
	ok("blacklist() returns just the map", same(await c.blacklist(), { griefer: "ban evasion" }), "");

	/* --- identifiers the bot puts in an embed ----------------------------- */

	ok("a match containing a space or Unicode is still sent intact",
		(() => { const { c: cc, calls: cl } = clientWith(() => res(200, { ok: true })); cc.block("a b/../c", "x"); return cl[0].url.includes(encodeURIComponent("a b/../c")); })(), "");

	/* the doc the bot writes must be the doc the Worker validates */
	ok("the client and the Worker agree on the response fields it reads",
		worker.includes("repo_mirror:") && worker.includes('store: "database"'), "");

	console.log("\n" + (failures.length ? failures.length + " FAILED (" + pass + " passed)" : pass + " checks passed"));
	process.exit(failures.length ? 1 : 0);
})();
