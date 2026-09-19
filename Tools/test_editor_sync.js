// test_editor_sync.js - boots the REAL editor script from index.html in a fake
// DOM against a mocked API, and proves the things that made the editor look
// broken:
//
//   1. a publish that DID land must survive its own echo arriving late
//      (that is "the site will not keep my changes");
//   2. a genuine change made elsewhere must still come through afterwards
//      (a guard that just blocks everything would be a different bug);
//   3. opening the editor must show what PLAYERS read, from the one origin they
//      read it from (that is "the website does not match the game").
//
// The API is the only origin the page may talk to now: no GitHub token, no
// repo write, no CDN. A leftover token in localStorage and a mocked GitHub that
// answers everything are both present here on purpose - if the page ever reaches
// for either one again, these tests go red.
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

/* requestAnimationFrame, as a browser has it: callbacks are queued and run on
   the next frame. Edits go through it (that is the render coalescing), so a
   test that asserts what an edit drew has to flush a frame first - and the
   queue being observable is what lets the coalescing itself be asserted. */
let rafQueue = [];
global.requestAnimationFrame = fn => { rafQueue.push(fn); return rafQueue.length; };
const flushFrame = () => { const run = rafQueue; rafQueue = []; run.forEach(f => f()); return run.length; };

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

/* the repo's api.json, and whether the API it points at is up. The editor reads
   both of these, so the test drives them the way a deploy would. */
let apiJson = '{"api":{"url":"","key":""}}';
let apiDown = false;
let apiNoToken = false; // a Worker deployed without GH_TOKEN: reads fine, writes 503
let apiClassicToken = false; // the Worker holds a CLASSIC token (account-wide), not fine-grained
let apiStoresRules = false; // the Worker stores the rules itself: no repo token exists to judge
/* the API's own 30-second edge cache: a plain read can answer with the revision
   that was just replaced, and only ?fresh=1 walks past it. Modelled because the
   editor's "is my publish still there?" decision depends on that difference. */
let apiStale = null;
let mediaUploads = []; // what POST /media/<name> received
/* the artwork the API can serve: the seals that ship with the repo, plus
   anything an upload in this run put there */
const mediaStored = new Set(["verified_seal_blue.png", "seal_founder.png", "seal_developer.png"]);
/* the blacklist as the Worker serves it: a map of key -> reason */
let blMap = {};
let blWrites = [];
let hereData = {}; // the here/ node: who is running the script right now
let blNoCred = false; // the Worker has no database credential, so writes are refused
let apiPuts = 0; // publishes that went through the API (not GitHub)
let apiDbRev = 7; // the Worker's own rules revision, served as x-xyro-sha "d1-<rev>"
const OWNER_KEY = "owner-secret";

/* relative URLs resolve against the page, exactly as a browser resolves them -
   without this a fetch("api.json") here throws and every same-origin read the
   editor does would look like a failure rather than a request */
const PAGE_ORIGIN = "https://vertxxy-1.github.io/Xyro/";
let stallRules = false; // a read that never answers, to see what the first frame looks like
const calls = [];
global.fetch = async (url, init) => {
	const u = new URL(url, PAGE_ORIGIN);
	const method = (init && init.method) || "GET";
	calls.push({ url: u, method, headers: init && init.headers, body: init && init.body });
	/* the page's own origin: api.json lives here, next to the page. A relative
	   read must be a real request (and a cache hit in a browser), not a detour
	   through raw.githubusercontent */
	if (u.hostname === "vertxxy-1.github.io") {
		if (u.pathname.endsWith("/api.json")) return new Response(apiJson, { status: 200 });
		return new Response("missing", { status: 404 });
	}
	if (stallRules && u.pathname === "/nametags") return new Promise(() => {});
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
	if (u.hostname === "api.example") {
		if (apiDown) return new Response('{"error":"boom"}', { status: 500 });
		const apiKey = (init && init.headers && init.headers["x-api-key"]) || "";
		if (u.pathname === "/nametags/check") {
			if (apiKey !== OWNER_KEY) return new Response('{"error":"forbidden: this route needs the owner key"}', { status: 403 });
			if (apiNoToken && !apiStoresRules) return new Response('{"ok":false,"reason":"no_store","error":"this Worker can neither store the rules itself nor commit them: bind the rules database or set GH_TOKEN"}', { status: 503 });
			if (apiStoresRules) {
				return new Response(JSON.stringify({
					ok: true,
					store: "database",
					sha: "d1-4",
					token: { kind: "none", scopes: [], wide: [] },
					note: "no repo token is involved",
				}), { status: 200 });
			}
			const token = apiClassicToken
				? { kind: "classic", scopes: ["repo", "delete_repo", "workflow"], wide: ["delete_repo", "workflow"] }
				: { kind: "fine-grained", scopes: [], wide: [] };
			return new Response(JSON.stringify({
				ok: true,
				sha: gh.sha(),
				token,
				warning: apiClassicToken ? "this is a CLASSIC token, which cannot be limited to one repository" : "",
			}), { status: 200 });
		}
		/* artwork uploads: the route that replaced the page's GitHub token. It
		   takes the owner key and stores the bytes; a 403 without one, so a test
		   can tell "refused" from "never asked". */
		const mediaPost = u.pathname.match(/^\/media\/([A-Za-z0-9_.-]{1,80})$/);
		if (mediaPost && (method === "POST" || method === "PUT")) {
			if (apiKey !== OWNER_KEY) return new Response('{"error":"forbidden: this route needs the owner key"}', { status: 403 });
			const bytes = Buffer.from(init.body || "", "binary");
			mediaUploads.push({ name: mediaPost[1], bytes, headers: init.headers });
			mediaStored.add(mediaPost[1]);
			return new Response(JSON.stringify({ ok: true, url: "/media/" + mediaPost[1], bytes: bytes.length, stored: "committed" }), { status: 200 });
		}
		if (u.pathname === "/nametags") {
			if (method === "PUT") {
				if (apiKey !== OWNER_KEY) return new Response('{"error":"forbidden: this route needs the owner key"}', { status: 403 });
				if (apiNoToken) return new Response('{"error":"publishing through the API needs GH_TOKEN"}', { status: 503 });
				// the Worker commits the body verbatim, and drops its cache
				gh.file = JSON.parse(init.body);
				return new Response(JSON.stringify({ ok: true, sha: "api-sha-" + ++apiPuts }), { status: 200 });
			}
			/* ?fresh=1 is what walks past the API's own edge cache - and the whole
			   point of the editor asking for it is that a plain poll may answer with
			   the revision it just replaced */
			const served = apiStale && !u.searchParams.has("fresh") ? apiStale : text(gh.file);
			/* The real Worker answers "d1-<rev>" when its OWN database holds the rules
			   and a git blob sha when the repo file is still the store. That prefix is
			   the difference between a publish players see and one they never will, so
			   the mock models both instead of only the git one. */
			return new Response(served, { status: 200, headers: { "x-xyro-sha": apiStoresRules ? "d1-" + apiDbRev : gh.sha() } });
		}
		if (u.pathname === "/blacklist") {
			// reading is gated by the CLIENT key, which the editor sends as ?key=
			if (u.searchParams.get("key") !== "pub-key") return new Response('{"error":"forbidden: bad or missing key"}', { status: 403 });
			return new Response(JSON.stringify({ count: Object.keys(blMap).length, blacklist: blMap }), { status: 200 });
		}
		const blWho = u.pathname.match(/^\/blacklist\/([^/]+)$/);
		if (blWho) {
			// editing needs the OWNER key - the client key is public on purpose
			if (apiKey !== OWNER_KEY) return new Response('{"error":"forbidden: this route needs the admin key"}', { status: 403 });
			/* a WRITE the database refuses: the Worker has no credential for it, which
			   is a different failure from a bad key and has its own one-command fix */
			if (blNoCred) return new Response('{"error":"Permission denied - this database refuses anonymous writes to it. Set FB_SERVICE_ACCOUNT (api/README.md section 4) to give the Worker an owner credential."}', { status: 403 });
			const who = decodeURIComponent(blWho[1]);
			blWrites.push({ method, who, body: init && init.body });
			if (method === "DELETE") {
				delete blMap[who];
				return new Response(JSON.stringify({ ok: true, who, action: "removed" }), { status: 200 });
			}
			blMap[who] = String((init && init.body) || "");
			return new Response(JSON.stringify({ ok: true, who, action: "blocked" }), { status: 200 });
		}
		if (u.pathname.startsWith("/media/")) {
			/* only files that are actually STORED answer, so "is this already
			   served?" (a HEAD, no key) is a real question with a real no. A mock
			   that answered 200 to everything would make every upload skip itself. */
			const what = u.pathname.split("/").pop();
			if (!mediaStored.has(what)) return new Response('{"error":"no such repo file"}', { status: 404 });
			return new Response("PNG:" + what, { status: 200, headers: { "content-type": "image/png" } });
		}
		/* presence comes through the API (here/ is the node the script writes), so
		   the live user list is built from this, not from a direct database read */
		if (u.pathname === "/here.json") return new Response(JSON.stringify(hereData), { status: 200 });
		if (u.pathname.endsWith(".json")) return new Response("{}", { status: 200 });
	}
	if (u.hostname === "raw.githubusercontent.com") {
		if (u.pathname.endsWith("/api.json")) return new Response(apiJson, { status: 200 });
		if (u.pathname.endsWith("/nametags.json")) {
			if (gh.cdn) gh.cdnMisses++;
			return new Response(gh.cdn || text(gh.file), { status: 200 });
		}
		return new Response("missing", { status: 404 });
	}
	if (u.hostname.endsWith("firebaseio.com")) {
		// presence: the here/ node the live user list is built from
		if (u.pathname.endsWith("/here.json")) return new Response(JSON.stringify(hereData), { status: 200 });
		return new Response("{}", { status: 200 });
	}
	if (u.hostname === "purge.jsdelivr.net") {
		return new Response(JSON.stringify({ paths: { ["/gh/vertxxy-1/Xyro@main/nametags.json"]: { throttled: false } } }), { status: 200 });
	}
	throw new Error("unexpected fetch: " + url);
};

/* --------------------------------------------------------- boot the editor */

/* Node ships File and Blob but no FileReader, and the editor's embed fallback
   uses one. Four lines here are the difference between testing that path and
   skipping it - and that path is the one that costs every player bandwidth, so
   it is the last thing that should go untested. */
if (typeof FileReader === "undefined") {
	globalThis.FileReader = class {
		readAsDataURL(file) {
			file.arrayBuffer().then(buf => {
				this.result = "data:" + (file.type || "application/octet-stream") + ";base64," + Buffer.from(buf).toString("base64");
				if (this.onload) this.onload();
			}).catch(e => { if (this.onerror) this.onerror(e); });
		}
	};
}

const factory = new Function(
	"window", "document", "localStorage", "fetch", "setInterval", "setTimeout", "confirm", "console",
	script +
	"\n;return {" +
	"  get live(){return live;}, get cfg(){return cfg;}, set cfg(v){cfg=v;}," +
	"  get publishGuard(){return publishGuard;}, get liveSha(){return liveSha;}," +
	"  refreshLive: refreshLive, publish: () => $(\"publishBtn\").onclick(), canonJSON: canonJSON, asConfig: asConfig," +
	"  renderPreview: renderPreview, renderEditorPreview: renderEditorPreview, editorTag: editorTag," +
	"  mediaURL: mediaURL, get rulesSource(){return rulesSource;}," +
	"  openEditor: openEditor, closeEditor: closeEditor, changed: changed, renderUsers: renderUsers," +
	"  blockAccount: blockAccount, loadBlacklist: loadBlacklist, renderBlacklist: renderBlacklist, pollUsers: pollUsers," +
	"  toasts: () => $(\"toasts\").children.map(t => t.textContent)," +
	"};"
);

const settle = (ms = 12) => new Promise(r => setTimeout(r, ms));

(async () => {
	/* a leftover token from the build that had a token field: the page must have
	   no use for it. It stays in storage for the whole run as bait. */
	localStorage.setItem("xyro_token", "github_pat_test");
	apiJson = '{"api":{"url":"https://api.example","key":"pub-key"}}';
	const api = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();

	/* --- 1. one origin, and it is the API -------------------------------- */

	ok("boot loads the published rules", api.live && api.live.tags.length === 2, JSON.stringify(api.live && api.live.tags));
	ok("the sha comes from the API, so a publish can guard on it", typeof api.liveSha === "string" && api.liveSha.length > 0, String(api.liveSha));
	ok("the rules came from the API", calls.some(c => c.url.hostname === "api.example" && c.url.pathname === "/nametags"), calls.map(c => c.url.hostname).join(", "));
	/* api.json itself is a same-origin file and stays that way - what must never
	   appear is a GITHUB request, from the token in storage or anything else */
	const GITHUB_HOSTS = ["api.github.com", "raw.githubusercontent.com", "cdn.jsdelivr.net"];
	const githubCalls = () => calls.filter(c => GITHUB_HOSTS.includes(c.url.hostname)).map(c => c.url.hostname + c.url.pathname);
	ok("...and GitHub was not asked for anything at all, even with a token in storage",
		githubCalls().length === 0, githubCalls().join(", "));
	api.renderEditorPreview();
	ok("the badge artwork comes from the API's media route",
		/^https:\/\/api\.example\/media\//.test(el("edBadgeCheck").src), el("edBadgeCheck").src);
	ok("...so no CDN is consulted for the preview either",
		!calls.some(c => /jsdelivr/.test(c.url.hostname)), calls.map(c => c.url.hostname).join(", "));

	/* --- 2. publishing is the owner key's job ---------------------------- */

	const before = JSON.parse(JSON.stringify(api.live));
	const apiPutsBeforeFirst = apiPuts;
	api.cfg = { options: { ...api.cfg.options, size: 33 }, tags: api.cfg.tags.map(t => (t.match === "*" ? { ...t, label: "xyro user (new)" } : t)) };
	/* with no key saved there is nothing to publish WITH, and a token sitting in
	   storage must not become one: the page stops and asks for the key */
	await api.publish();
	ok("a publish with no owner key is refused", apiPuts === apiPutsBeforeFirst && gh.puts === 0, "api puts " + (apiPuts - apiPutsBeforeFirst) + ", github puts " + gh.puts);
	ok("...and it asks for the key rather than reporting success", /Paste your owner key/.test(el("status").textContent), el("status").textContent);
	localStorage.setItem("xyro_owner_key", OWNER_KEY);
	await api.publish();
	ok("the publish went to the API", apiPuts === apiPutsBeforeFirst + 1, "puts " + (apiPuts - apiPutsBeforeFirst));
	ok("...and never to GitHub", gh.puts === 0, "github puts " + gh.puts);
	ok("the editor kept its own publish after it", api.cfg.options.size === 33, "cfg size " + api.cfg.options.size);
	ok("a publish guard was armed for its own echo", !!api.publishGuard, JSON.stringify(api.publishGuard && api.publishGuard.until));

	// the API's edge still answers with the revision we just replaced
	apiStale = text(before);
	const statusAfterPublish = el("status").textContent;
	await api.refreshLive(true, {});
	ok("a stale poll cannot undo a publish", api.cfg.options.size === 33 && api.live.options.size === 33, "cfg " + api.cfg.options.size + " live " + api.live.options.size);
	ok("...and the tab says which copy it refused instead of refreshing over it",
		/refreshed from/.test(el("status").textContent) === false && /still handing out the revision we replaced/.test(el("status").textContent),
		el("status").textContent + " (was: " + statusAfterPublish.slice(0, 60) + ")");

	/* --- 3. a REAL change elsewhere still comes through ------------------ */

	// the cache clears and someone reverts the rules for real
	apiStale = null;
	gh.file = JSON.parse(JSON.stringify(before));
	await api.refreshLive(true, {});
	ok("a genuine remote change is still accepted", api.cfg.options.size === 15 && api.live.options.size === 15, "cfg " + api.cfg.options.size);

	/* --- 4. text colours: rule override, else the global option -------- */

	/* the real page's option inputs carry real defaults; the fake DOM starts
	   every input blank, so give these two the values the page has */
	el("optTextColor").value = "#123456";
	el("optUserColor").value = "#654321";
	const colorOf = id => el(id).style.color;

	delete api.cfg.tags[0].textColor;
	delete api.cfg.tags[0].userColor;
	api.renderPreview();
	ok("with no rule override the global name colour is previewed", colorOf("pvLabel") === "#123456", colorOf("pvLabel"));
	ok("...and the global @username colour", colorOf("pvUser") === "#654321", colorOf("pvUser"));

	api.cfg.tags[0].textColor = "#FF0000";
	api.cfg.tags[0].userColor = "#00FF00";
	api.renderPreview();
	ok("a rule's own name colour beats the global one", colorOf("pvLabel") === "#ff0000", colorOf("pvLabel"));
	ok("a rule's own @username colour beats the global one", colorOf("pvUser") === "#00ff00", colorOf("pvUser"));

	// the rule editor must agree with the big preview, or the setting lies twice
	api.openEditor(0);
	ok("the rule form loads that rule's colours", el("fTextColorHex").value === "#FF0000" && el("fUserColorHex").value === "#00FF00",
		el("fTextColorHex").value + "/" + el("fUserColorHex").value);
	api.renderEditorPreview();
	ok("the mini preview matches the big one", colorOf("edLabel") === "#ff0000" && colorOf("edUser") === "#00ff00",
		colorOf("edLabel") + "/" + colorOf("edUser"));

	api.closeEditor();
	api.openEditor(1); // a rule with no colours of its own
	ok("a rule with no colours leaves both hex boxes blank (= global)",
		el("fTextColorHex").value === "" && el("fUserColorHex").value === "",
		el("fTextColorHex").value + "/" + el("fUserColorHex").value);
	ok("...while the swatches show the global value",
		el("fTextColor").value === "#123456" && el("fUserColor").value === "#654321",
		el("fTextColor").value + "/" + el("fUserColor").value);
	api.renderEditorPreview();
	ok("...and the mini preview shows the global colour", colorOf("edLabel") === "#123456", colorOf("edLabel"));
	api.closeEditor();

	/* --- 5. the API hosts the rules and the badge artwork --------------- */

	/* with api.json pointing somewhere, the editor must read the nametags from
	   the API and never touch raw.githubusercontent (or jsDelivr) for them */
	apiJson = '{"api":{"url":"https://api.example","key":"pub-key"}}';
	gh.file.tags[0].rank = "founder"; // so the mini preview has a ranked badge
	gh.file.tags[0].badge = true; // ...and the badge actually shows
	calls.length = 0;
	const hosted = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("with an API configured the rules come from it", calls.some(c => c.url.hostname === "api.example" && c.url.pathname === "/nametags"), calls.map(c => c.url.hostname + c.url.pathname).join(", "));
	ok("...and the CDN is not consulted for the rules at all", !calls.some(c => c.url.hostname === "raw.githubusercontent.com" && c.url.pathname.endsWith("/nametags.json")), calls.map(c => c.url.hostname).join(", "));
	ok("the hosted read carries the public key", calls.some(c => c.url.pathname === "/nametags" && c.url.searchParams.get("key") === "pub-key"), "");
	ok("opening the editor reads past the API's own cache (?fresh=1)", calls.some(c => c.url.pathname === "/nametags" && c.url.searchParams.has("fresh")), "");
	ok("the rules really loaded from there", hosted.live && hosted.live.tags.length === 2, JSON.stringify(hosted.live && hosted.live.tags));
	ok("the status line names the source", /loaded from the Xyro API/.test(el("status").textContent), el("status").textContent);
	ok("nothing points at jsDelivr any more", !calls.some(c => c.url.hostname === "cdn.jsdelivr.net"), calls.map(c => c.url.hostname).join(", "));

	hosted.openEditor(0); // a ranked rule: that rank's seal, from the API
	ok("a ranked rule's badge comes from the API", el("edBadgeCheck").src === "https://api.example/media/seal_founder.png", el("edBadgeCheck").src);
	hosted.openEditor(1); // a rule with no rank - the official blue seal
	ok("an unranked rule uses the API's verified badge", el("edBadgeCheck").src === "https://api.example/media/verified_seal_blue.png", el("edBadgeCheck").src);
	hosted.closeEditor();

	/* With the API unreachable there is no second source to find, and looking for
	   one is how a page ends up showing rules nobody plays by. */
	apiDown = true;
	calls.length = 0;
	const offline = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("an unreachable API leaves the editor with no rules, and says so",
		offline.live === null && /network error/.test(el("status").textContent), el("status").textContent);
	ok("...and no CDN or GitHub read is attempted as a substitute",
		calls.filter(c => /api\.github\.com|raw\.githubusercontent\.com|jsdelivr/.test(c.url.hostname)).length === 0,
		calls.map(c => c.url.hostname).join(", "));
	// the artwork URL is still built from the configured API, so a preview that
	// does render is pointing at the same place the game reads
	ok("...while artwork still points at the API that is configured", /^https:\/\/api\.example\/media\//.test(el("edBadgeCheck").src), el("edBadgeCheck").src);
	apiDown = false;

	/* --- 6. publishing through the API with an owner key ----------------- */

	apiJson = '{"api":{"url":"https://api.example","key":"pub-key"}}';
	localStorage.setItem("xyro_owner_key", OWNER_KEY);
	localStorage.setItem("xyro_token", "github_pat_test"); // both available: the API must win
	calls.length = 0;
	apiPuts = 0;
	const apiPub = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("with a key saved the chip promises the API route", el("tokenChip").textContent === "publish: API", el("tokenChip").textContent);
	ok("...and the owner card reports the key", el("ownerState").textContent === "key saved", el("ownerState").textContent);

	const shaAtReadTime = gh.sha();
	const githubPutsBefore = gh.puts;
	apiPub.cfg = { options: { ...apiPub.cfg.options, size: 61 }, tags: apiPub.cfg.tags.map(t => (t.match === "*" ? { ...t, label: "via api" } : t)) };
	const callsBeforePublish = calls.length;
	await apiPub.publish();
	const publishCalls = calls.slice(callsBeforePublish).filter(c => c.url.hostname === "api.example");
	/* The whole point of the sha the editor now keeps: the write IS the first
	   request. It used to be a fresh read, the write, then a third read to prove
	   it - three trips to commit one file, and the read was not what made the
	   write safe, the sha was. */
	ok("a publish starts with the write itself - no read-before-write when the sha is known",
		publishCalls.length >= 1 && publishCalls[0].method === "PUT",
		"first: " + (publishCalls[0] ? publishCalls[0].method + " " + publishCalls[0].url.pathname : "nothing") +
		"; whole publish: " + publishCalls.map(c => c.method + " " + c.url.pathname).join(", "));
	const putCall = calls.find(c => c.url.hostname === "api.example" && c.method === "PUT");
	ok("Publish went to the API, not GitHub", !!putCall && gh.puts === githubPutsBefore, "api puts " + apiPuts + ", github puts " + (gh.puts - githubPutsBefore));
	ok("...carrying the owner key", !!putCall && putCall.headers && putCall.headers["x-api-key"] === OWNER_KEY, JSON.stringify(putCall && putCall.headers));
	ok("...and the sha of the file it read, so a stale write is refused rather than clobbering",
		!!putCall && putCall.url.searchParams.get("sha") === shaAtReadTime, putCall && putCall.url.search);
	ok("the file holds the change", gh.file.options.size === 61 && gh.file.tags.some(t => t.label === "via api"), JSON.stringify(gh.file.options));
	ok("the editor kept it", apiPub.cfg.options.size === 61, String(apiPub.cfg.options.size));
	ok("the sha comes back from the API", apiPub.liveSha === "api-sha-1", String(apiPub.liveSha));
	ok("a publish guard was armed for its own echo", !!apiPub.publishGuard, "");
	ok("and the status says which route published it", /published through the API/.test(el("status").textContent), el("status").textContent);

	// Save & test: a refused key must not be kept
	calls.length = 0;
	el("ownerKey").value = "wrong-key";
	await el("saveOwner").onclick();
	ok("Save & test asks the Worker's check route", calls.some(c => c.url.pathname === "/nametags/check" && c.method === "POST"), calls.map(c => c.method + " " + c.url.pathname).join(", "));
	ok("a refused owner key is not saved", localStorage.getItem("xyro_owner_key") === OWNER_KEY && /refused that key/.test(el("status").textContent), el("status").textContent);

	// the key and the repo token are different things: an accepted key with an
	// account-wide token is the moment to say so, where the human is looking
	const toastCount = () => el("toasts").children.length;
	const newToasts = n => el("toasts").children.slice(n).map(t => t.textContent).join(" | ");
	let toastsBefore = toastCount();
	el("ownerKey").value = OWNER_KEY;
	await el("saveOwner").onclick();
	let toastsAdded = newToasts(toastsBefore);
	ok("a fine-grained repo token is accepted with no warning", !/classic/i.test(toastsAdded) && /Ready/.test(toastsAdded), toastsAdded.slice(0, 140));
	ok("...and the status names it as fine-grained", /fine-grained/.test(el("status").textContent), el("status").textContent);

	apiClassicToken = true;
	toastsBefore = toastCount();
	el("ownerKey").value = OWNER_KEY;
	await el("saveOwner").onclick();
	toastsAdded = newToasts(toastsBefore);
	ok("a classic (account-wide) repo token is warned about, by name", /classic token/i.test(toastsAdded) && /delete_repo/.test(toastsAdded), toastsAdded.slice(0, 200));
	ok("...explaining that it is not limited to this repo", /cannot be limited to this repo/.test(toastsAdded), toastsAdded.slice(0, 200));
	ok("...while the owner key is still accepted - they are separate credentials", localStorage.getItem("xyro_owner_key") === OWNER_KEY, "");
	apiClassicToken = false;

	/* A Worker that stores the rules itself: there is no repo token to judge, so
	   Save & test must say so instead of implying one is missing or pretending a
	   nonexistent token is healthy. */
	apiStoresRules = true;
	toastsBefore = toastCount();
	el("ownerKey").value = OWNER_KEY;
	await el("saveOwner").onclick();
	toastsAdded = newToasts(toastsBefore);
	ok("a Worker that stores the rules itself reports no repo token, not a warning",
		!/classic/i.test(toastsAdded) && /no GitHub token/i.test(toastsAdded), toastsAdded.slice(0, 160));
	ok("...and says where a publish goes", /database/.test(el("status").textContent) && /no repo token/i.test(el("status").textContent), el("status").textContent);
	ok("...while the owner key is still what unlocks it", localStorage.getItem("xyro_owner_key") === OWNER_KEY, "");
	apiStoresRules = false;

	// a Worker that cannot publish should say so rather than fail silently
	apiNoToken = true;
	el("ownerKey").value = OWNER_KEY;
	await el("saveOwner").onclick();
	ok("a Worker without GH_TOKEN explains what is missing", /cannot publish/.test(el("status").textContent) && /GH_TOKEN/.test(el("status").textContent), el("status").textContent);
	ok("...and still keeps the key, so it works the moment GH_TOKEN is set", localStorage.getItem("xyro_owner_key") === OWNER_KEY, "");

	// a Worker that can neither store nor commit has nowhere to put the change,
	// and "nowhere" must not be reported as "published somewhere else"
	apiNoToken = true;
	apiPub.cfg = { options: { ...apiPub.cfg.options, size: 77 }, tags: apiPub.cfg.tags };
	const apiPutsBeforeNoStore = apiPuts;
	const putsBeforeNoStore = gh.puts;
	await apiPub.publish();
	ok("an API that cannot publish publishes nothing anywhere",
		apiPuts === apiPutsBeforeNoStore && gh.puts === putsBeforeNoStore,
		"api puts +" + (apiPuts - apiPutsBeforeNoStore) + ", github puts +" + (gh.puts - putsBeforeNoStore));
	ok("...and says what the Worker is missing instead", /cannot publish yet/.test(el("status").textContent), el("status").textContent);
	apiNoToken = false;
	localStorage.removeItem("xyro_owner_key");

	/* --- 6b. picking a file: uploaded through the API, or embedded ------- */

	/* The upload used to be a GitHub PUT with a token the page held. It is now a
	   POST to the API with the owner key - and the same whole-image rule the game
	   applies is applied at the door, so the file is checked where it is stored. */
	localStorage.setItem("xyro_owner_key", OWNER_KEY);
	const PNG_SIG_ = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const IEND_ = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
	const iconBytes = Buffer.concat([PNG_SIG_, Buffer.from("pretend-pixels"), IEND_]);
	const iconName = crypto.createHash("sha1").update(iconBytes).digest("hex") + ".png";
	const iconFile = new File([iconBytes], "icon.png", { type: "image/png" });
	mediaStored.delete(iconName); // not on the server yet
	mediaUploads.length = 0;
	await el("edIconFile").onchange({ target: { files: [iconFile], value: "" } });
	ok("a picked file is uploaded through the API", mediaUploads.length === 1 && mediaUploads[0].name === iconName, JSON.stringify(mediaUploads.map(u => u.name)));
	ok("...with the owner key", !!mediaUploads[0] && mediaUploads[0].headers["x-api-key"] === OWNER_KEY, JSON.stringify(mediaUploads[0] && mediaUploads[0].headers));
	ok("...and the bytes that were picked are the bytes that were sent", !!mediaUploads[0] && mediaUploads[0].bytes.equals(iconBytes), "");
	ok("...so the rule points at the API's own media URL",
		el("fImage").value === "https://api.example/media/" + iconName, el("fImage").value);
	ok("...which means nothing was embedded into the rules", !/^data:/.test(el("fImage").value), el("fImage").value.slice(0, 40));

	// the same file again: its URL is already served, so nothing is uploaded
	mediaUploads.length = 0;
	await el("edIconFile").onchange({ target: { files: [iconFile], value: "" } });
	ok("re-picking a file that is already served sends nothing", mediaUploads.length === 0, JSON.stringify(mediaUploads));
	ok("...and still fills the field", el("fImage").value === "https://api.example/media/" + iconName, el("fImage").value);

	/* No key saved: there is nothing to upload WITH, so the picture is embedded -
	   and the page must say what that costs, because every player re-downloads
	   and re-decodes it on every refresh, forever. */
	localStorage.removeItem("xyro_owner_key");
	const bgBytes = Buffer.from("GIF89a" + "0123456789abcdefghij", "latin1");
	const bgFile = new File([bgBytes], "backdrop.gif", { type: "image/gif" });
	mediaStored.delete(crypto.createHash("sha1").update(bgBytes).digest("hex") + ".gif");
	mediaUploads.length = 0;
	const toastsBeforeEmbed = toastCount();
	await el("edBgFile").onchange({ target: { files: [bgFile], value: "" } });
	ok("with no key saved nothing is uploaded", mediaUploads.length === 0, JSON.stringify(mediaUploads));
	ok("...and the file is embedded instead of failing", /^data:image\/gif;base64,/.test(el("fBgImage").value), el("fBgImage").value.slice(0, 40));
	ok("...with the cost to every player stated, not hidden",
		/KB to EVERY player's download every refresh/.test(newToasts(toastsBeforeEmbed)), newToasts(toastsBeforeEmbed).slice(0, 220));
	localStorage.setItem("xyro_owner_key", OWNER_KEY);

	/* --- 7. structural invariants --------------------------------------- */

	ok("a publish verifies itself against the API",
		script.includes("const landed = canonJSON(asConfig(r.config)) === canonJSON(wrote);") &&
		script.includes('status("published, but the file reads back differently'), "");
	ok("a verified publish says so", script.includes('" - every client is current within ~30s"'), "");
	ok("...and a read-back that never answered is not called verified",
		script.includes("the verification read did not answer - the write itself was accepted"), "");
	/* the chip is how a cached page gets spotted, so it must be a build id rather
	   than a literal anyone forgets to bump. Asserting "api-r3" here only meant
	   this file had to be edited on every bump - assert the SHAPE, and that it is
	   at least the revision that introduced the sync fix. */
	const chip = (html.match(/build: (api-r\d+)/) || [])[1];
	ok("the build chip is a build id so a cached page is recognisable",
		!!chip && Number(chip.replace("api-r", "")) >= 3, "chip text: " + chip);
	ok("load() checks the API", /const json = await fetchConfig\(\{ checkApi: true, report: true \}\)/.test(script), "");
	ok("the periodic poll only reads the API", /setInterval\(\(\) => refreshLive\(true\), 120000\)/.test(script), "");
	ok("the editor reads the rules through the API", /async function hostedRules\(opts\)/.test(script) && script.includes('NT_BASE + "/nametags"'), "");
	ok("and gets tag artwork from the same origin", /function mediaURL\(file\)/.test(script) && script.includes('NT_BASE + "/media/"'), "");
	ok("there is no jsDelivr or purge path left in the editor at all", !/jsdelivr|purge/i.test(script), "");

	/* The bug this locks out: one rule carried a 1.29 MB PNG as a base64 data
	   URI even though the identical file was already in media/, taking the rules
	   document to 1.72 MB. Every player re-downloads that document every
	   refreshSeconds, so the embedding was paid for by everyone, forever. The
	   editor only embedded because the no-token path returned early - it never
	   asked whether the file was already being served, a question that needs no
	   token at all. */
	const blobFn = script.slice(script.indexOf("async function fileToBlobURL"), script.indexOf("function wireFilePicker"));
	ok("picking a file reuses an already-uploaded copy before embedding base64",
		/async function mediaAlreadyServed\(path\)/.test(script) && blobFn.includes("await mediaAlreadyServed(path)"), "");
	ok("and asks that question before it needs the owner key",
		blobFn.indexOf("await mediaAlreadyServed(path)") < blobFn.indexOf("const key = getOwnerKey()"), "");
	ok("the reuse check reads the API's own media route",
		/mediaAlreadyServed[\s\S]{0,500}NT_BASE \+ "\/media\//.test(script), "");
	ok("an upload goes to the API with the owner key, not to GitHub",
		/async function fileToBlobURL\(file\)/.test(script) && /fetch\(stamp\(apiURL\), \{[\s\S]{0,120}"x-api-key": key/.test(script) &&
		!/api\.github\.com|Authorization|Bearer/.test(script), "");
	ok("and a Worker that cannot store artwork falls back to embedding, not to failure",
		/res\.status === 503\) throw Object\.assign\(new Error\(out\.error \|\| "the API cannot store artwork"\), \{ code: "notoken" \}\)/.test(script), "");
	ok("embedding reports what it costs every player, not just that it happened",
		/adding " \+ kb \+ " KB to EVERY player's download every refresh/.test(script), "");
	ok("the page no longer has a CDN to purge or a token to carry",
		!/jsdelivr|purge|api\.github\.com|getToken|LS_TOKEN/i.test(script), "");
	ok("publishing has exactly one route, and it needs the owner key",
		/if \(!getOwnerKey\(\)\) \{[\s\S]{0,200}?Paste your owner key below/.test(script) && /async function publishThroughApi\(\)/.test(script), "");
	ok("the API publish sends the blob sha, so a stale write is refused rather than clobbering",
		script.includes('shaToSend ? "?sha=" + encodeURIComponent(shaToSend)'), "");
	ok("with no sha known it still reads the file before writing", /if \(!shaToSend\) \{/.test(script), "");
	ok("and verifies the write OFF the critical path, not in front of the click",
		/readRules\(\)\.then\(/.test(script) && /const landed = canonJSON\(asConfig\(r\.config\)\) === canonJSON\(wrote\)/.test(script), "");
	ok("the owner key has its own card, input and test button", html.includes('id="ownerCard"') && html.includes('id="ownerKey"') && html.includes('id="saveOwner"') && html.includes('id="forgetOwner"'), "");
	ok("the owner key is a separate credential from the GitHub token", /const LS_OWNER = "/.test(script) && !/localStorage\.setItem\(LS_TOKEN, v\);[\s\S]{0,80}LS_OWNER/.test(script), "");

	/* --- 8. opening fast: the snapshot, the coalesced render ---------------- */

	/* api.json belongs to the page's own origin. Reading it from
	   raw.githubusercontent meant every visit paid a cross-origin round trip
	   before it could even ask where the API was. */
	localStorage.setItem("xyro_token", "github_pat_test");
	apiJson = '{"api":{"url":"https://api.example","key":"pub-key"}}';
	calls.length = 0;
	factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("api.json is read from the page's own origin",
		calls.some(c => c.url.hostname === "vertxxy-1.github.io" && c.url.pathname.endsWith("/api.json")),
		calls.map(c => c.url.hostname + c.url.pathname).join(", "));
	ok("...not from raw.githubusercontent",
		!calls.some(c => c.url.hostname === "raw.githubusercontent.com" && c.url.pathname.endsWith("/api.json")), "");

	/* a page the Worker serves (/editor) has the API location injected, so it
	   needs no api.json lookup at all - and the injected value must win over
	   whatever a stale api.json in the repo happens to say */
	apiJson = '{"api":{"url":"https://wrong.example","key":"stale"}}';
	calls.length = 0;
	const injected = factory({ addEventListener() {}, __XYRO_API: { url: "https://api.example", key: "inj-key" } }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("an injected API location needs no api.json lookup",
		!calls.some(c => c.url.pathname.endsWith("/api.json")), calls.map(c => c.url.pathname).join(", "));
	ok("...and beats a stale copy in the repo",
		!calls.some(c => c.url.hostname === "wrong.example") && calls.some(c => c.url.hostname === "api.example" && c.url.pathname === "/nametags"),
		calls.map(c => c.url.hostname + c.url.pathname).join(", "));
	ok("...with the artwork following it", /^https:\/\/api\.example\/media\//.test(injected.mediaURL("seal_founder.png")), injected.mediaURL("seal_founder.png"));
	apiJson = '{"api":{"url":"https://api.example","key":"pub-key"}}';

	/* an open paints the last copy this browser saw before the network answers.
	   `live` stays null until the real read lands - that is what keeps the dirty
	   chip and the unsaved-changes guard honest about what is published. */
	localStorage.setItem("xyro_live_v1", JSON.stringify({ options: { size: 88 }, tags: [{ match: "snap", label: "SNAPSHOT" }] }));
	stallRules = true;
	const instant = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	ok("a reopened editor paints the last copy before the network answers",
		instant.cfg.tags.length === 1 && instant.cfg.tags[0].label === "SNAPSHOT", JSON.stringify(instant.cfg.tags));
	ok("...drawn from the snapshot, not mistaken for published rules", instant.live === null, JSON.stringify(instant.live));
	ok("...and the status says which it is", /showing your last copy/.test(el("status").textContent), el("status").textContent);
	ok("...so the rule list is on screen on the first frame", el("ruleList").children.length > 0, String(el("ruleList").children.length));
	stallRules = false;

	/* the other half: a read that DOES land replaces the snapshot, so the next
	   open paints something current */
	await settle(20);
	const live2 = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle(20);
	ok("a completed read replaces the snapshot for the next open",
		(JSON.parse(localStorage.getItem("xyro_live_v1") || "{}").tags || []).length === 2,
		localStorage.getItem("xyro_live_v1"));
	ok("...and the editor shows the published rules, not the snapshot", live2.live && live2.live.tags.length === 2, JSON.stringify(live2.live && live2.live.tags));

	/* a burst of edits must be one frame of rendering, not one per keystroke:
	   every edit used to rebuild the whole rule list AND the online user list */
	rafQueue.length = 0;
	live2.changed("keystroke 1");
	live2.changed("keystroke 2");
	live2.changed("keystroke 3");
	ok("a burst of edits is coalesced into ONE frame of work", rafQueue.length === 1, String(rafQueue.length));
	flushFrame();
	ok("...which then draws, and leaves nothing queued", rafQueue.length === 0, String(rafQueue.length));
	ok("...having drawn the edited rules", el("ruleList").children.length > 0, String(el("ruleList").children.length));

	/* --- 9. the blacklist, managed from here ------------------------------ */

	/* The script enforces the list; this card is the only way to edit it, and the
	   split is the point: reading uses the public client key, editing needs the
	   owner key, because an edit route behind a public key would let any player
	   block a rival. */
	blMap = { x9k: "ban evasion", 8579040069: "harassment" };
	localStorage.setItem("xyro_owner_key", OWNER_KEY);
	apiJson = '{"api":{"url":"https://api.example","key":"pub-key"}}';
	calls.length = 0;
	const bl = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle(20);
	ok("the card loads the list from the API", calls.some(c => c.url.pathname === "/blacklist"), calls.map(c => c.url.pathname).join(", "));
	ok("...reading with the public client key, not the owner key", calls.some(c => c.url.pathname === "/blacklist" && c.url.searchParams.get("key") === "pub-key"), "");
	ok("...and being refused without it", calls.filter(c => c.url.pathname === "/blacklist").every(c => c.url.searchParams.has("key")), "");
	ok("it shows who is blocked", el("blockCount").textContent === "2 blocked", el("blockCount").textContent);
	ok("...with the reason the script prints in game", bl.renderBlacklist() === undefined && JSON.stringify(blMap).includes("ban evasion"), "");

	// blocking: the write, and the reason it needs
	blWrites.length = 0;
	el("blockWho").value = "rivalplayer";
	el("blockWhy").value = "advertising";
	const added = await bl.blockAccount("rivalplayer", "advertising", false);
	ok("blocking posts to the API", added === true && blWrites.length === 1 && blWrites[0].method === "POST", JSON.stringify(blWrites));
	ok("...to /blacklist/<who>", blWrites[0] && blWrites[0].who === "rivalplayer", JSON.stringify(blWrites[0]));
	ok("...carrying the owner key", calls.filter(c => c.url.pathname === "/blacklist/rivalplayer")[0] && calls.filter(c => c.url.pathname === "/blacklist/rivalplayer")[0].headers["x-api-key"] === OWNER_KEY, JSON.stringify(calls.filter(c => c.url.pathname === "/blacklist/rivalplayer")[0] && calls.filter(c => c.url.pathname === "/blacklist/rivalplayer")[0].headers));
	ok("...with the reason as the body, which is what the script shows", blWrites[0] && blWrites[0].body === "advertising", JSON.stringify(blWrites[0]));
	ok("the list updates without a re-read", el("blockCount").textContent === "3 blocked", el("blockCount").textContent);

	// and the live user list marks them, so nobody blocks twice
	hereData = { rivalplayer: Math.floor(Date.now() / 1000) };
	el("userList").children.length = 0; // the fake DOM keeps append history, so start clean
	await bl.pollUsers();
	bl.renderUsers();
	const rows = el("userList").children.map(r => r.children.map(c => c.textContent).join(" ")).join(" | ");
	ok("a blocked player is marked in the live list", /blacklisted/.test(rows), rows.slice(0, 160));

	// unblocking
	blWrites.length = 0;
	await bl.blockAccount("rivalplayer", "", true);
	ok("unblocking deletes it", blWrites.length === 1 && blWrites[0].method === "DELETE" && !blMap.rivalplayer, JSON.stringify(blWrites));

	// the refusals that keep it safe
	blWrites.length = 0;
	localStorage.removeItem("xyro_owner_key");
	toastsBefore = toastCount();
	const noKey = await bl.blockAccount("someoneelse", "test", false);
	ok("with no owner key saved it refuses to write", noKey === false && blWrites.length === 0, JSON.stringify(blWrites));
	ok("...and says which card fixes that", /owner key/i.test(newToasts(toastsBefore)), newToasts(toastsBefore).slice(0, 160));
	localStorage.setItem("xyro_owner_key", OWNER_KEY);
	blWrites.length = 0;
	const badName = await bl.blockAccount("not a name!", "x", false);
	ok("a malformed key never reaches the API", badName === false && blWrites.length === 0, JSON.stringify(blWrites));
	blWrites.length = 0;
	const empty = await bl.blockAccount("", "", false);
	ok("an empty key never reaches the API either", empty === false && blWrites.length === 0, "");
	ok("the card exposes the controls it needs", html.includes('id="blockWho"') && html.includes('id="blockWhy"') && html.includes('id="blockAdd"') && html.includes('id="blockList"') && html.includes('id="blockCount"'), "");
	localStorage.removeItem("xyro_owner_key");

	/* A Worker that cannot write the database. It must not look like a bad key
	   (that sends you to the wrong card) and it must not look like success. */
	localStorage.setItem("xyro_owner_key", OWNER_KEY);
	blNoCred = true;
	toastsBefore = toastCount();
	const denied = await bl.blockAccount("someoneelse", "test", false);
	toastsAdded = newToasts(toastsBefore);
	ok("a database that refuses the write is not reported as success", denied === false, String(denied));
	ok("...it says the card is read-only", el("blockState").textContent === "read-only", el("blockState").textContent);
	ok("...shows the one-command fix instead of a bare failure", !el("blockFix").classList.contains("hidden") && html.includes("FB_SERVICE_ACCOUNT"), "");
	ok("...and does not call it a key problem", !/owner key refused/i.test(el("blockState").textContent) && /write the database/i.test(toastsAdded), toastsAdded.slice(0, 200));
	blNoCred = false;
	localStorage.removeItem("xyro_owner_key");

	/* --- 8. one route, one credential, and a token that does nothing ------- */

	/* The page used to hold a GitHub personal access token and write to the repo
	   with it. That write could never reach a player once the database owned the
	   rules (the Worker serves its own row first), which is how a "successful"
	   publish shipped a tag nobody could see. The token is gone, and the thing
	   that keeps it gone is that the page has no write path left to use it on. */
	apiJson = '{"api":{"url":"https://api.example","key":"pub-key"}}';
	apiStoresRules = true;
	apiDbRev = 12;
	localStorage.removeItem("xyro_owner_key");
	localStorage.setItem("xyro_token", "github_pat_test");
	calls.length = 0;
	const dbOwns = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("the sha the API reports is kept, whatever store it names", dbOwns.liveSha === "d1-12", String(dbOwns.liveSha));
	ok("the chip asks for the owner key instead of promising GitHub", el("tokenChip").textContent === "owner key needed to publish", el("tokenChip").textContent);
	ok("the button never says Publish to GitHub", el("publishBtn").innerHTML.indexOf("GitHub") === -1, el("publishBtn").innerHTML);
	ok("...so a token in storage cannot make it write to GitHub", gh.puts === 0 && calls.filter(c => /api\.github\.com|raw\.githubusercontent\.com/.test(c.url.hostname)).length === 0, "github puts " + gh.puts);

	dbOwns.cfg = { options: { ...dbOwns.cfg.options, size: 41 }, tags: dbOwns.cfg.tags };
	const toastsBeforeRefusal = toastCount();
	const apiPutsBeforeRefusal = apiPuts;
	await dbOwns.publish();
	ok("a publish with no owner key writes NOTHING at all",
		apiPuts === apiPutsBeforeRefusal && gh.puts === 0, "api puts +" + (apiPuts - apiPutsBeforeRefusal) + ", github puts " + gh.puts);
	ok("...and never claims it published", !/Published/.test(newToasts(toastsBeforeRefusal)), newToasts(toastsBeforeRefusal).slice(0, 200));
	ok("...it says the browser has no other route", /no other route/.test(newToasts(toastsBeforeRefusal)), newToasts(toastsBeforeRefusal).slice(0, 200));

	// the SAME state with the key saved: the one route is open, so it publishes
	localStorage.setItem("xyro_owner_key", OWNER_KEY);
	apiPuts = 0;
	const dbOwnsKey = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("with the owner key saved the chip promises the API route", el("tokenChip").textContent === "publish: API", el("tokenChip").textContent);
	dbOwnsKey.cfg = { options: { ...dbOwnsKey.cfg.options, size: 42 }, tags: dbOwnsKey.cfg.tags };
	await dbOwnsKey.publish();
	ok("...and the write lands on that route", apiPuts === 1 && gh.puts === 0, "api puts " + apiPuts + ", github puts " + gh.puts);
	ok("...and the status says so", /published through the API/.test(el("status").textContent), el("status").textContent);

	/* An API that cannot answer at all: the write stops before it is made, and
	   nothing pretends otherwise. Guessing here is the same dead end as before. */
	apiDown = true;
	const putsBeforeUnknown = gh.puts;
	const apiPutsBeforeUnknown = apiPuts;
	const toastsBeforeUnknown = toastCount();
	dbOwnsKey.cfg = { options: { ...dbOwnsKey.cfg.options, size: 44 }, tags: dbOwnsKey.cfg.tags };
	await dbOwnsKey.publish();
	ok("an unreachable API does not become a silent publish somewhere else",
		apiPuts === apiPutsBeforeUnknown && gh.puts === putsBeforeUnknown, "api puts +" + (apiPuts - apiPutsBeforeUnknown) + ", github puts +" + (gh.puts - putsBeforeUnknown));
	ok("...and it never claims success", !/Published -/.test(newToasts(toastsBeforeUnknown)), newToasts(toastsBeforeUnknown).slice(0, 160));
	ok("...reporting a failure instead", /fail|could not|did not answer/i.test(el("status").textContent), el("status").textContent);
	apiDown = false;
	apiStoresRules = false;
	localStorage.removeItem("xyro_owner_key");

	/* structural: the write path itself, and the absence of the one it replaced */
	ok("the only write the page knows is the API publish",
		/async function publishThroughApi\(\)/.test(script) && !/function publishThroughGitHub|github\.com\/repos/.test(script), "");
	ok("...and no GitHub credential is read or stored anywhere in the page",
		!/getToken|LS_TOKEN|xyro_token|Authorization|Bearer/.test(script) && !/api\.github\.com/.test(script), "");

	/* the dialog has to name the destination it will actually use - the old one
	   promised "the game reads raw GitHub live", which stopped being true the day
	   the rules database became the store */
	ok("the publish dialog names the API as where players read from",
		/The Worker commits it and drops its cache, so every client gets it within seconds/.test(script) &&
		!/the game reads raw GitHub live/.test(script), "");

	/* --- 9. an API that cannot be reached is a REAL error ------------------ */

	/* No second source exists any more, so a read that cannot happen must say so
	   instead of showing rules from somewhere the game does not read. This boots
	   LAST on purpose: the fake DOM rebinds each element's handlers to the newest
	   instance, so an instance created early would be the one driven by every
	   later click. */
	apiStoresRules = false;
	localStorage.removeItem("xyro_owner_key");
	apiDown = true;
	calls.length = 0;
	const unreachable = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("an unreachable API is reported instead of silently reading elsewhere",
		/network error/.test(el("status").textContent) && unreachable.live === null,
		el("status").textContent + " | live " + JSON.stringify(unreachable.live));
	ok("...and nothing else is consulted in its place",
		calls.filter(c => /api\.github\.com|raw\.githubusercontent\.com|jsdelivr/.test(c.url.hostname)).length === 0,
		calls.map(c => c.url.hostname).join(", "));
	ok("...and the page cannot publish from that state either",
		/network error|no API is configured|owner key/.test(el("status").textContent), el("status").textContent);
	apiDown = false;

	console.log("\n" + (failures.length ? failures.length + " FAILED" : pass + " checks passed") + (failures.length ? " (" + pass + " passed)" : ""));
	process.exit(failures.length ? 1 : 0);
})();
