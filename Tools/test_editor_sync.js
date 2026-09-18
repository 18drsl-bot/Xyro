// test_editor_sync.js - boots the REAL editor script from index.html in a fake
// DOM against a mocked GitHub, and proves the two things that made the editor
// look broken:
//
//   1. a publish that DID land must survive a stale CDN copy coming back
//      (that is "the site will not keep my changes");
//   2. a genuine change made elsewhere must still come through afterwards
//      (a guard that just blocks everything would be a different bug);
//   3. opening the editor must show the FILE, not a CDN's older idea of it
//      (that is "the website does not match nametags.json").
//
//   node Tools/test_editor_sync.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
	if (cond) pass++;
	else {
		failures.push(name + (extra ? " -> " + extra : ""));
		console.log("FAIL " + name + (extra ? " -> " + extra : ""));
	}
}

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ------------------------------------------------------------- fake DOM */

const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function makeEl(id) {
	const el = {
		id: id || "",
		value: "",
		className: "",
		src: "",
		placeholder: "",
		checked: false,
		disabled: false,
		children: [],
		style: { setProperty() {}, removeProperty() {} },
		classList: {
			set: new Set(),
			add(...c) { c.forEach(x => this.set.add(x)); },
			remove(...c) { c.forEach(x => this.set.delete(x)); },
			contains(c) { return this.set.has(c); },
			toggle(c, f) { const want = f === undefined ? !this.set.has(c) : !!f; want ? this.set.add(c) : this.set.delete(c); return want; },
		},
		addEventListener() {},
		removeEventListener() {},
		appendChild(n) { this.children.push(n); return n; },
		append(...n) { this.children.push(...n); },
		prepend(n) { this.children.unshift(n); },
		remove() {},
		click() {},
		focus() {},
		blur() {},
		scrollIntoView() {},
		setAttribute() {},
		getAttribute() { return null; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		insertBefore() {},
		cloneNode() { return makeEl(id); },
	};
	el._text = "";
	Object.defineProperty(el, "textContent", {
		get() { return this._text; },
		set(v) { this._text = String(v == null ? "" : v); },
		configurable: true,
	});
	// esc() reads innerHTML straight back, and the toasts print their textContent
	Object.defineProperty(el, "innerHTML", {
		get() { return esc(this._text); },
		set(v) { this._text = String(v).replace(/<[^>]*>/g, ""); },
		configurable: true,
	});
	return el;
}

const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };

const document = {
	title: "",
	body: makeEl("body"),
	getElementById: el,
	createElement: tag => makeEl(tag),
	addEventListener() {},
	querySelector() { return null; },
	querySelectorAll() { return []; },
};

const store = new Map();
const localStorage = {
	getItem: k => (store.has(k) ? store.get(k) : null),
	setItem: (k, v) => store.set(k, String(v)),
	removeItem: k => store.delete(k),
	clear: () => store.clear(),
};

const timers = [];
const setIntervalFn = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
const setTimeoutFn = (fn) => { return 0; }; // the purge retry loop: not exercised

const logs = [];
const consoleStub = { log: (...a) => logs.push(["log", ...a]), warn: (...a) => logs.push(["warn", ...a]), error: (...a) => logs.push(["error", ...a]), info: (...a) => logs.push(["info", ...a]) };

/* --------------------------------------------------- mocked GitHub + CDN */

const CONFIG_A = { options: { size: 15, pillColor: "#0000BD" }, tags: [{ match: "furyrAin620", label: "x9k" }, { match: "*", label: "xyro user" }] };
const shaOf = text => crypto.createHash("sha1").update(text).digest("hex");
const text = cfg => JSON.stringify({ options: cfg.options, tags: cfg.tags }, null, "\t") + "\n";

const gh = {
	file: JSON.parse(JSON.stringify(CONFIG_A)), // the actual file on GitHub
	cdn: null, // what raw.githubusercontent hands back (null = current file)
	cdnMisses: 0,
	puts: 0,
	conflicts: 0,
	sha() { return shaOf(text(this.file)); },
};

const calls = [];
global.fetch = async (url, init) => {
	const u = new URL(url);
	const method = (init && init.method) || "GET";
	calls.push({ url: u, method });
	if (u.hostname === "api.github.com") {
		if (u.pathname.endsWith("/contents/nametags.json")) {
			if (method === "PUT") {
				const body = JSON.parse(init.body);
				if (body.sha !== gh.sha()) { gh.conflicts++; return new Response('{"message":"does not match"}', { status: 409 }); }
				const decoded = Buffer.from(body.content, "base64").toString("utf8");
				gh.file = JSON.parse(decoded);
				gh.puts++;
				return new Response(JSON.stringify({ content: { sha: gh.sha() } }), { status: 200 });
			}
			if (u.pathname === "/repos/vertxxy-1/Xyro/contents/nametags.json") {
				return new Response(JSON.stringify({ content: Buffer.from(text(gh.file)).toString("base64"), sha: gh.sha(), size: text(gh.file).length }), { status: 200 });
			}
		}
		return new Response('{"message":"not found"}', { status: 404 });
	}
	if (u.hostname === "raw.githubusercontent.com") {
		if (u.pathname.endsWith("/api.json")) return new Response('{"api":{"url":"","key":""}}', { status: 200 });
		if (u.pathname.endsWith("/nametags.json")) {
			if (gh.cdn) gh.cdnMisses++;
			return new Response(gh.cdn || text(gh.file), { status: 200 });
		}
		return new Response("missing", { status: 404 });
	}
	if (u.hostname.endsWith("firebaseio.com")) return new Response("{}", { status: 200 });
	if (u.hostname === "purge.jsdelivr.net") {
		return new Response(JSON.stringify({ paths: { ["/gh/vertxxy-1/Xyro@main/nametags.json"]: { throttled: false } } }), { status: 200 });
	}
	throw new Error("unexpected fetch: " + url);
};

/* --------------------------------------------------------- boot the editor */

const factory = new Function(
	"window", "document", "localStorage", "fetch", "setInterval", "setTimeout", "confirm", "console",
	script +
	"\n;return {" +
	"  get live(){return live;}, get cfg(){return cfg;}, set cfg(v){cfg=v;}," +
	"  get publishGuard(){return publishGuard;}, get liveSha(){return liveSha;}," +
	"  refreshLive: refreshLive, publish: () => $(\"publishBtn\").onclick(), canonJSON: canonJSON, asConfig: asConfig," +
	"  toasts: () => $(\"toasts\").children.map(t => t.textContent)," +
	"};"
);

const settle = (ms = 12) => new Promise(r => setTimeout(r, ms));

(async () => {
	localStorage.setItem("xyro_token", "github_pat_test");
	const api = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();

	/* --- 1. the editor shows the file, not the CDN's older copy ---------- */

	ok("boot loads the published rules", api.live && api.live.tags.length === 2, JSON.stringify(api.live && api.live.tags));
	ok("the token is honoured, so the file sha is known", typeof api.liveSha === "string" && api.liveSha.length > 0, String(api.liveSha));

	// now the CDN starts handing back the PREVIOUS revision
	gh.cdn = text({ options: { size: 99, pillColor: "#0000BD" }, tags: [{ match: "*", label: "old cached copy" }] });
	await api.refreshLive(false, { checkApi: true });
	ok("a stale CDN copy is not mistaken for the file", api.live.tags.length === 2 && api.live.options.size === 15, JSON.stringify(api.live.tags));
	ok("...and the API was consulted to decide that", calls.some(c => c.url.hostname === "api.github.com" && c.method === "GET"));

	/* --- 2. a publish that lands survives a stale poll ------------------- */

	const before = JSON.parse(JSON.stringify(api.live));
	api.cfg = { options: { ...api.cfg.options, size: 33 }, tags: api.cfg.tags.map(t => (t.match === "*" ? { ...t, label: "xyro user (new)" } : t)) };
	await api.publish();
	ok("the publish reached the file", gh.puts === 1 && gh.file.options.size === 33, "puts " + gh.puts + " size " + gh.file.options.size);
	ok("the editor kept its own publish after it", api.cfg.options.size === 33, "cfg size " + api.cfg.options.size);
	ok("a publish guard was armed", !!api.publishGuard, JSON.stringify(api.publishGuard && api.publishGuard.until));
	ok("the publish did not land on a stale sha", gh.conflicts === 0, String(gh.conflicts));

	// the CDN is still serving the pre-publish copy, and the poll runs
	gh.cdn = text(before);
	const statusAfterPublish = el("status").textContent;
	await api.refreshLive(true, {});
	ok("a stale poll cannot undo a publish", api.cfg.options.size === 33 && api.live.options.size === 33, "cfg " + api.cfg.options.size + " live " + api.live.options.size);
	ok("...and the tab does not claim it refreshed over it", el("status").textContent === statusAfterPublish && !/refreshed from GitHub/.test(el("status").textContent), el("status").textContent);

	// Without a token the poll reads raw alone - which is exactly where the
	// stale copy used to win. The guard has to ask the API before believing it.
	localStorage.removeItem("xyro_token");
	await api.refreshLive(true, {});
	ok("tokenless: a stale poll still cannot undo a publish", api.cfg.options.size === 33 && api.live.options.size === 33, "cfg " + api.cfg.options.size + " live " + api.live.options.size);
	ok("tokenless: and it says which copy it rejected", /cached copy/.test(el("status").textContent), el("status").textContent);

	/* --- 3. a REAL change elsewhere still comes through ------------------ */

	// someone reverts the file for real: the API agrees with the CDN this time
	gh.file = JSON.parse(JSON.stringify(before));
	gh.cdn = text(before);
	await api.refreshLive(true, {});
	ok("a genuine remote change is still accepted", api.cfg.options.size === 15 && api.live.options.size === 15, "cfg " + api.cfg.options.size);

	/* --- 4. structural invariants --------------------------------------- */

	ok("the publish verifies itself against the API", script.includes("const landed = check ? canonJSON(asConfig(check.config)) === canonJSON(wanted) : null;") && script.includes('status("published, but GitHub'), "");
	ok("a verified publish says so", script.includes('status("published and checked against the file"'), "");
	ok("the build chip is bumped so a cached page is recognisable", /build: api-r3/.test(html), "chip text");
	ok("load() checks the API", /const json = await fetchConfig\(\{ checkApi: true, report: true \}\)/.test(script), "");
	ok("the periodic poll stays off the API budget when there is no token", script.includes("!!getToken() || !!opts.checkApi || !raw"), "");

	console.log("\n" + (failures.length ? failures.length + " FAILED" : pass + " checks passed") + (failures.length ? " (" + pass + " passed)" : ""));
	process.exit(failures.length ? 1 : 0);
})();
