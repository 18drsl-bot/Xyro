// test_loader_gate.js - the loader's kill-switch decision, plus a structural
// check that the refusal happens BEFORE anything is downloaded or executed.
//   node Tools/test_loader_gate.js
//
// The mirror below is a straight port of the gate block in loadstring.lua: where
// the gate lives (api.json first, firebase.json second), and what each answer
// means. The structural half reads the real file, because "the return is too
// late" is exactly the kind of bug a mirrored-logic test cannot see.
const fs = require("fs");
const path = require("path");

let fails = 0;
function check(name, cond, extra) {
	if (!cond) fails++;
	console.log((cond ? "OK  " : "FAIL") + " " + name + (extra ? " -> " + extra : ""));
}

/* ------------------------------------------------ mirrored decision logic */

// a fake world: files that exist, and what the gate endpoint answers
function loadGate(world) {
	const out = { gateUrl: undefined, scriptUrl: undefined, ran: true, warned: "", notified: [] };
	const cfg = world.api === undefined ? null : world.api;
	const api = cfg && typeof cfg === "object" ? (cfg.api || cfg) : null;
	if (api && typeof api.url === "string" && api.url !== "") {
		const base = api.url.replace(/\/+$/, "");
		const key = typeof api.key === "string" ? api.key : "";
		const q = key !== "" ? "?key=" + encodeURIComponent(key) : "";
		out.gateUrl = base + "/gate" + q;
		out.scriptUrl = base + "/script" + q;
	} else if (world.firebase && world.firebase.url) {
		out.gateUrl = String(world.firebase.url).replace(/\/+$/, "") + "/staff/gate.json";
	}
	if (!out.gateUrl) return out; // nothing configured: behave exactly as before

	const body = world.gateBody; // undefined = the read failed
	if (body === undefined) return out; // unreadable = fail open
	let parsed = null;
	try {
		parsed = JSON.parse(body);
	} catch {
		parsed = null; // a decode failure is also "no usable gate"
	}
	let gate = null;
	if (parsed === false) gate = { enabled: false };
	else if (parsed && typeof parsed === "object") gate = parsed;

	if (gate && gate.enabled === false) {
		out.ran = false;
		out.notified.push("Xyro is disabled: " + (gate.message || "Try again later."));
		return out;
	}
	if (gate && typeof gate.warn === "string" && gate.warn !== "") {
		out.warned = gate.warn;
		out.notified.push("Xyro: " + gate.warn);
	}
	return out;
}

const WORKER = { api: { url: "https://xyro-api.x.workers.dev/", key: "k1" } };

// 1. api.json wins and builds the right URLs
let r = loadGate({ api: WORKER.api, gateBody: '{"enabled":true}' });
check("api.json builds the gate + script URLs", r.gateUrl === "https://xyro-api.x.workers.dev/gate?key=k1" && r.scriptUrl === "https://xyro-api.x.workers.dev/script?key=k1", r.gateUrl);
check("enabled gate: the loader runs", r.ran === true);

// 2. the kill switch itself
r = loadGate({ api: WORKER.api, gateBody: '{"enabled":false,"message":"back in 10 minutes"}' });
check("disabled gate: the loader refuses to run", r.ran === false);
check("disabled gate: the reason is shown", /back in 10 minutes/.test(r.notified.join(" ")), r.notified.join(" | "));

// 3. a bare boolean, as typed straight into the Firebase console
r = loadGate({ api: WORKER.api, gateBody: "false" });
check("a bare false disables the loader", r.ran === false);

// 4. fail open: a database hiccup must never lock everyone out
r = loadGate({ api: WORKER.api, gateBody: undefined });
check("an unreadable gate lets the loader run", r.ran === true);
r = loadGate({ api: WORKER.api, gateBody: "not json at all" });
check("an undecodable gate lets the loader run", r.ran === true);

// 5. warn runs but notifies
r = loadGate({ api: WORKER.api, gateBody: '{"enabled":true,"warn":"restart in 5"}' });
check("warn does not stop the loader", r.ran === true && r.warned === "restart in 5", r.warned);

// 6. no api.json: the gate still works straight from the database
r = loadGate({ firebase: { url: "https://xyro-fcaf8-default-rtdb.firebaseio.com/" }, gateBody: '{"enabled":false}' });
check("firebase.json alone can drive the gate", r.gateUrl === "https://xyro-fcaf8-default-rtdb.firebaseio.com/staff/gate.json" && r.ran === false, String(r.gateUrl));

// 7. nothing configured: zero behaviour change
r = loadGate({});
check("no config = no gate at all", r.gateUrl === undefined && r.ran === true);

/* --------------------------------------- structural check on the real file */

const lua = fs.readFileSync(path.join(__dirname, "..", "loadstring.lua"), "utf8");
const lines = lua.split("\n");
const idx = needle => lines.findIndex(l => l.includes(needle));

const gateRefusal = lines.findIndex(l => l.includes("the remote gate has this script switched off"));
const firstDownload = idx("local probeApi = fetch(API_URL)");
const apiScriptTry = lines.findIndex(l => l.includes("local body = fetch(scriptUrl)"));
const execute = lines.findIndex(l => l.includes('local fn, cerr = load(src, "=xyro")'));

check("the gate check exists", gateRefusal > -1);
check("...before the first download", gateRefusal > -1 && firstDownload > -1 && gateRefusal < firstDownload, `gate ${gateRefusal} vs download ${firstDownload}`);
check("...and long before anything is executed", execute > -1 && gateRefusal < execute, `gate ${gateRefusal} vs load ${execute}`);
check("the API source is tried before the plain mirrors", apiScriptTry > -1 && apiScriptTry < idx("for _, url in ipairs(SOURCES)"), `${apiScriptTry} vs mirrors`);
check("the gate reads api.json before firebase.json", idx('repoFile("api.json")') < idx('repoFile("firebase.json")'));
check("a failed gate read still inserts the script source", lua.includes("if scriptUrl then") && lua.includes("table.insert(SOURCES, scriptUrl)"));

/* ------------------------------- structural check on xyro.lua's kill switch */

const xyro = fs.readFileSync(path.join(__dirname, "..", "xyro.lua"), "utf8");
const xlines = xyro.split("\n");
const xidx = needle => xlines.findIndex(l => l.includes(needle));

check("xyro.lua parses the gate out of the staff payload", xyro.includes("H.GATE = fbParseGate(data.gate)"));
check("xyro.lua has an enforcement entry point", xyro.includes("H.gateEnforce = function()"));
// the boot call comes before the window's own cleanup hook even exists, i.e.
// long before any feature is built (the notice cards create their own ScreenGui
// far earlier, so those are not a useful marker)
const bootEnforce = xidx("H.gateEnforce()");
const uiHook = xidx("_G.ScriptHubCleanup = function()");
check("it is enforced at boot, before features mount", bootEnforce > -1 && uiHook > -1 && bootEnforce < uiHook, `enforce line ${bootEnforce + 1} vs UI hook ${uiHook + 1}`);
check("it is enforced at the end of the file too", xyro.trimEnd().endsWith("end)") && xidx("REMOTE GATE (kill switch)") > xidx("BLACKLIST ENFORCEMENT"), "tail: " + JSON.stringify(xyro.trimEnd().slice(-12)));
check("running clients poll it from the transport loop", xyro.includes("if H.fbGatePoll and ticks % 10 == 0 then"));
check("the poll reads the database-shaped gate path", xyro.includes('H.fbGet(H.fbUrl("staff/gate.json"))'));
check("an unreadable poll keeps the last known state", xyro.includes("unreadable: keep whatever we already know"));
check("staff can check it in game", xyro.includes('name = "gate"') && xyro.includes("staff only"));
check("a refresh applies a shutdown", xyro.includes("the remote gate has the script disabled"));

console.log("\n" + (fails ? fails + " FAILED" : "all gate checks passed"));
process.exit(fails ? 1 : 0);
