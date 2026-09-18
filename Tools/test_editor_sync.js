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
let apiPuts = 0; // publishes that went through the API (not GitHub)
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
		if (u.pathname === "/nametags") {
			if (method === "PUT") {
				if (apiKey !== OWNER_KEY) return new Response('{"error":"forbidden: this route needs the owner key"}', { status: 403 });
				if (apiNoToken) return new Response('{"error":"publishing through the API needs GH_TOKEN"}', { status: 503 });
				// the Worker commits the body verbatim, and drops its cache
				gh.file = JSON.parse(init.body);
				return new Response(JSON.stringify({ ok: true, sha: "api-sha-" + ++apiPuts }), { status: 200 });
			}
			return new Response(text(gh.file), { status: 200, headers: { "x-xyro-sha": gh.sha() } });
		}
		if (u.pathname.startsWith("/media/")) {
			return new Response("PNG:" + u.pathname.split("/").pop(), { status: 200, headers: { "content-type": "image/png" } });
		}
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
	"  renderPreview: renderPreview, renderEditorPreview: renderEditorPreview, editorTag: editorTag," +
	"  mediaURL: mediaURL, get rulesSource(){return rulesSource;}," +
	"  openEditor: openEditor, closeEditor: closeEditor, changed: changed," +
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
	api.renderEditorPreview();
	ok("with no API configured the rules and the badge come from GitHub/jsDelivr as before",
		/loaded from GitHub/.test(el("status").textContent) && /cdn\.jsdelivr\.net\/gh\/vertxxy-1\/Xyro@main\/media\//.test(el("edBadgeCheck").src),
		el("status").textContent + " | " + el("edBadgeCheck").src);

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

	/* and when the API is down, the editor is exactly as it was before */
	apiDown = true;
	calls.length = 0;
	const offline = factory({ addEventListener() {} }, document, localStorage, global.fetch, setIntervalFn, setTimeoutFn, () => true, consoleStub);
	await settle();
	ok("an unreachable API falls back to the old GitHub path", offline.live && offline.live.tags.length === 2 && calls.some(c => c.url.hostname === "raw.githubusercontent.com" && c.url.pathname.endsWith("/nametags.json")), JSON.stringify(offline.live && offline.live.tags));
	ok("...and says where those rules came from", /loaded from GitHub/.test(el("status").textContent), el("status").textContent);
	// the API itself is reachable, so the artwork still comes from it - only the
	// rules read failed, and the CDN would be the wrong answer for that
	ok("...while artwork still comes from the reachable API", /^https:\/\/api\.example\/media\//.test(el("edBadgeCheck").src), el("edBadgeCheck").src);
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

	// an API that can read but not write: the GitHub token still gets it done
	apiPub.cfg = { options: { ...apiPub.cfg.options, size: 77 }, tags: apiPub.cfg.tags };
	const putsBeforeFallback = gh.puts;
	await apiPub.publish();
	ok("an API that cannot publish falls back to the GitHub token", gh.puts === putsBeforeFallback + 1 && gh.file.options.size === 77, "github puts " + (gh.puts - putsBeforeFallback) + ", size " + gh.file.options.size);
	apiNoToken = false;
	localStorage.removeItem("xyro_owner_key");

	/* --- 7. structural invariants --------------------------------------- */

	ok("the publish verifies itself against the API", script.includes("const landed = check ? canonJSON(asConfig(check.config)) === canonJSON(wanted) : null;") && script.includes('status("published, but GitHub'), "");
	ok("a verified publish says so", script.includes('status("published and checked against the file"'), "");
	/* the chip is how a cached page gets spotted, so it must be a build id rather
	   than a literal anyone forgets to bump. Asserting "api-r3" here only meant
	   this file had to be edited on every bump - assert the SHAPE, and that it is
	   at least the revision that introduced the sync fix. */
	const chip = (html.match(/build: (api-r\d+)/) || [])[1];
	ok("the build chip is a build id so a cached page is recognisable",
		!!chip && Number(chip.replace("api-r", "")) >= 3, "chip text: " + chip);
	ok("load() checks the API", /const json = await fetchConfig\(\{ checkApi: true, report: true \}\)/.test(script), "");
	ok("the periodic poll stays off the API budget when there is no token", script.includes("!!getToken() || !!opts.checkApi || !raw"), "");
	ok("the editor reads the rules through the API when one is configured", /async function hostedRules\(opts\)/.test(script) && script.includes('NT_BASE + "/nametags"'), "");
	ok("and gets tag artwork from the same origin", /function mediaURL\(file\)/.test(script) && script.includes('NT_BASE + "/media/"'), "");
	ok("no hardcoded jsDelivr media URL is left in the editor", !/cdn\.jsdelivr\.net\/gh\/vertxxy-1\/Xyro@main\/media/.test(script), "");
	ok("a publish does not purge a CDN the API clients never read", /if \(!NT_BASE\) \{/.test(script) && /the API serves it, so every client is current/.test(script), "");
	ok("publishing prefers the API whenever a key is saved", script.includes("if (getOwnerKey() && NT_BASE) {") && /async function publishThroughApi\(\)/.test(script), "");
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

	console.log("\n" + (failures.length ? failures.length + " FAILED" : pass + " checks passed") + (failures.length ? " (" + pass + " passed)" : ""));
	process.exit(failures.length ? 1 : 0);
})();
