/**
 * nametags-client.js - read and edit the nametag rules from your own code: a
 * Discord bot, a CLI, a cron job.
 *
 * The rules are a row in the API's own database, so this talks to ONE route
 * pair and needs ONE credential:
 *
 *     GET  /nametags?fresh=1     the rules + the revision that guards a write
 *     PUT  /nametags?sha=<rev>   publish, refused with 409 if the rules moved
 *
 * No GitHub token, no jsDelivr purge, no database secret. The owner key
 * (XYRO_ADMIN_KEY) is the only secret involved, and it belongs on your machine
 * - never in a client, never in api.json.
 *
 * WHAT NOT TO DO, because it looks right and silently does nothing: commit
 * nametags.json to the repo with the GitHub API and expect players to see it.
 * The Worker serves the DATABASE first, so a repo commit is only a mirror -
 * it changes what git history says, not what the game reads. It is exactly the
 * trap this module exists to avoid.
 *
 *     const xyro = require("./api/nametags-client.js");
 *
 *     // read /nametag list
 *     const { rules } = await xyro.read();
 *
 *     // edit /nametag color @someone #5E0EAD - read, change, publish, and if
 *     // someone publishes in between it re-reads instead of clobbering them
 *     await xyro.edit(r => {
 *       const rule = xyro.find(r, "noixctl");
 *       if (!rule) throw new Error("no rule for that user");
 *       rule.color = "#5E0EAD";
 *     });
 *
 *     // delete /nametag remove @someone
 *     await xyro.edit(r => { if (!xyro.remove(r, "noixctl")) throw new Error("not found"); });
 *
 * Key, in order: the `key` option, XYRO_ADMIN_KEY, api/.xyro-admin-key,
 * ~/.xyro-admin-key - the same places api/gate.js looks. URL: the `url` option,
 * then XYRO_API_URL, then api.url in api.json.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const API_JSON = path.join(__dirname, "..", "api.json");
const KEY_FILES = [path.join(__dirname, ".xyro-admin-key"), path.join(os.homedir(), ".xyro-admin-key")];

/** The deployed Worker's address, from api.json so it follows the real deploy. */
function readApiUrl() {
	const fromEnv = String(process.env.XYRO_API_URL || "").trim();
	if (fromEnv) return fromEnv.replace(/\/+$/, "");
	try {
		const cfg = JSON.parse(fs.readFileSync(API_JSON, "utf8"));
		const url = cfg && cfg.api && cfg.api.url;
		if (typeof url === "string" && url.trim()) return url.trim().replace(/\/+$/, "");
	} catch {
		/* no api.json here - fall through to the error the caller will see */
	}
	return "";
}

/** The OWNER key. Not the `key` in api.json: that one is public and can only
 *  read, which is why it cannot publish. */
function readOwnerKey() {
	const fromEnv = String(process.env.XYRO_ADMIN_KEY || "").trim();
	if (fromEnv) return fromEnv;
	for (const file of KEY_FILES) {
		try {
			const value = fs.readFileSync(file, "utf8").trim();
			if (value) return value;
		} catch {
			/* not there - try the next place */
		}
	}
	return "";
}

/** `{options, tags}` and nothing else, the shape the editor publishes and the
 *  Worker validates. Anything else is refused here rather than sent and
 *  rejected with a message that says less. */
function shape(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("the rules must be an object");
	}
	if (!value.options || typeof value.options !== "object" || Array.isArray(value.options)) {
		throw new Error('the rules need an "options" object');
	}
	if (!Array.isArray(value.tags)) throw new Error('the rules need a "tags" array');
	return { options: value.options, tags: value.tags };
}

/** Tab-indented, which is what the editor and the repo file both use - so a
 *  diff of a bot-written publish is readable rather than a whole-file rewrite. */
function serialize(rules) {
	const doc = shape(rules);
	return JSON.stringify({ options: doc.options, tags: doc.tags }, null, "\t") + "\n";
}

/** Case-insensitive exact match on a rule's `match`, the same lookup the editor
 *  and the script do. Returns the rule itself, so a caller can mutate it. */
function find(rules, match) {
	const want = String(match == null ? "" : match).trim().toLowerCase();
	if (!want) return null;
	return (shape(rules).tags || []).find(t => String((t && t.match) || "").trim().toLowerCase() === want) || null;
}

/** Every rule's match, in the order they are evaluated. */
function list(rules) {
	return (shape(rules).tags || []).map(t => String((t && t.match) || ""));
}

/** Add a rule, or replace the existing one for the same `match`.
 *
 *  A NEW rule is inserted BEFORE a "*" catch-all. Rules match first-wins, so a
 *  rule appended after the wildcard can never fire - it would sit in the
 *  document, look correct in the editor, and do nothing in game. The editor
 *  does this too; a bot that appends plainly is how "the site and the bot
 *  disagree" starts. */
function set(rules, rule) {
	const doc = shape(rules);
	if (!rule || typeof rule !== "object") throw new Error("a rule must be an object");
	const match = String(rule.match == null ? "" : rule.match).trim();
	if (!match) throw new Error('a rule needs a "match" (a username, a user id, or "*")');
	const next = { ...rule, match };
	const at = doc.tags.findIndex(t => String((t && t.match) || "").trim().toLowerCase() === match.toLowerCase());
	if (at >= 0) {
		doc.tags[at] = next;
		return doc;
	}
	const star = doc.tags.findIndex(t => (t && t.match) === "*");
	if (star >= 0) doc.tags.splice(star, 0, next);
	else doc.tags.push(next);
	return doc;
}

/** Remove the rule for `match`. Returns true when something was removed. */
function remove(rules, match) {
	const doc = shape(rules);
	const want = String(match == null ? "" : match).trim().toLowerCase();
	const at = doc.tags.findIndex(t => String((t && t.match) || "").trim().toLowerCase() === want);
	if (at < 0) return false;
	doc.tags.splice(at, 1);
	return true;
}

/** A client bound to one Worker and one key. Every function above is pure and
 *  can be used on the document this returns. */
function createClient(options = {}) {
	const base = String(options.url || readApiUrl() || "").replace(/\/+$/, "");
	const key = String(options.key || readOwnerKey() || "").trim();
	const doFetch = options.fetch || globalThis.fetch;

	if (!base) {
		throw new Error("no API address - set api.url in api.json, or pass { url } (api/README.md)");
	}
	if (!key) {
		throw new Error("no owner key - set XYRO_ADMIN_KEY, or write it to api/.xyro-admin-key (api/README.md section 4)");
	}
	if (typeof doFetch !== "function") {
		throw new Error("this needs fetch - Node 18+ has it built in, or pass { fetch }");
	}

	async function call(method, route, body) {
		const headers = { "x-api-key": key, "x-xyro-by": String(options.by || "bot").slice(0, 60) };
		if (body !== undefined) headers["content-type"] = "application/json";
		let res;
		try {
			res = await doFetch(base + route, { method, headers, body, cache: "no-store" });
		} catch (err) {
			throw new Error("could not reach " + base + " (" + (err && err.message ? err.message : err) + ")");
		}
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			/* not JSON - keep the text for the error path */
		}
		return { status: res.status, json, text, rev: (res.headers && res.headers.get && res.headers.get("x-xyro-sha")) || "" };
	}

	/** The rules as they are right now, plus the revision that guards a write.
	 *
	 *  `?fresh=1` on purpose: a caller is about to change what it read, and the
	 *  Worker edge-caches this route for 30 seconds, so a cached answer would
	 *  mean publishing on top of a revision that has already moved on. */
	async function read() {
		const res = await call("GET", "/nametags?fresh=1");
		if (res.status !== 200 || !res.json) {
			throw new Error("could not read the rules: " + res.status + " " + (res.json && res.json.error ? res.json.error : res.text.slice(0, 200)));
		}
		return { rules: shape(res.json), rev: res.rev, source: res.rev ? "database" : "repo" };
	}

	/** Publish the whole document. One attempt, guarded by `rev`.
	 *
	 *  A 409 means the rules moved since the read, and the write is refused
	 *  rather than applied - which is what makes the single-request publish
	 *  safe. edit() is what handles it, by re-reading. */
	async function publish(rules, opts = {}) {
		const doc = serialize(rules);
		const rev = opts.rev == null ? "" : String(opts.rev);
		const route = "/nametags" + (rev ? "?sha=" + encodeURIComponent(rev) : "");
		const res = await call("PUT", route, doc);
		if (res.status === 409) {
			const err = new Error(res.json && res.json.error ? res.json.error : "conflict: the rules moved since this read");
			err.code = "conflict";
			err.status = 409;
			throw err;
		}
		if (res.status !== 200 || !res.json || res.json.ok !== true) {
			const err = new Error("publish failed: " + res.status + " " + (res.json && res.json.error ? res.json.error : res.text.slice(0, 200)));
			err.status = res.status;
			throw err;
		}
		return { rev: res.json.sha, bytes: res.json.bytes, store: res.json.store, mirror: res.json.repo_mirror, ok: true };
	}

	/** Read, change, and publish. `change` is handed the document and may edit
	 *  it in place or return a replacement.
	 *
	 *  If someone publishes while you are editing - the web editor, another
	 *  command - the write is refused with 409 and this does the whole thing
	 *  again on top of THEIR revision, rather than overwriting rules it never
	 *  read. That loop is the difference between a bot and a footgun; the
	 *  alternative is "the bot undid my edit", which is impossible to debug
	 *  afterwards. It gives up after `attempts` and reports the conflict. */
	async function edit(change, opts = {}) {
		const attempts = Math.max(1, Number(opts.attempts) || 3);
		let lastConflict = null;
		for (let i = 0; i < attempts; i++) {
			const { rules, rev } = await read();
			const next = (await change(rules)) || rules;
			try {
				return await publish(next, { rev });
			} catch (err) {
				if (err && err.code === "conflict") {
					lastConflict = err;
					continue;
				}
				throw err;
			}
		}
		throw lastConflict || new Error("the rules kept changing under this edit");
	}

	/** POST /nametags/check - is this key accepted, and can the Worker publish?
	 *  Worth calling once at boot: it fails loudly on a bad key instead of on
	 *  the first staff command. */
	async function check() {
		const res = await call("POST", "/nametags/check", "");
		return { ok: res.status === 200 && !!(res.json && res.json.ok), status: res.status, detail: res.json || res.text.slice(0, 200) };
	}

	/* ---- the blacklist: same key, same worker, no database secret ---------- */

	async function blacklist() {
		const res = await call("GET", "/blacklist");
		if (res.status !== 200 || !res.json) throw new Error("could not read the blacklist: " + res.status);
		return res.json.blacklist || {};
	}

	async function block(who, reason) {
		const res = await call("POST", "/blacklist/" + encodeURIComponent(String(who).trim()), String(reason == null ? "" : reason).slice(0, 200));
		return { ok: res.status === 200 && !!(res.json && res.json.ok), status: res.status, detail: res.json || res.text.slice(0, 200) };
	}

	async function unblock(who) {
		const res = await call("DELETE", "/blacklist/" + encodeURIComponent(String(who).trim()));
		return { ok: res.status === 200 && !!(res.json && res.json.ok), status: res.status, detail: res.json || res.text.slice(0, 200) };
	}

	return { url: base, read, publish, edit, check, blacklist, block, unblock, serialize };
}

/* A ready-made instance, so `require("./api/nametags-client.js")` works when the
   key and api.json are already where they belong. `createClient` stays exported
   for a bot that keeps its own config. */
let shared = null;
function sharedClient() {
	if (!shared) shared = createClient();
	return shared;
}
const lazy = {};
for (const name of ["read", "publish", "edit", "check", "blacklist", "block", "unblock"]) {
	lazy[name] = (...args) => sharedClient()[name](...args);
}

module.exports = {
	createClient,
	readApiUrl,
	readOwnerKey,
	// pure helpers - work on any document, no network
	shape,
	serialize,
	find,
	list,
	set,
	remove,
	...lazy,
};
