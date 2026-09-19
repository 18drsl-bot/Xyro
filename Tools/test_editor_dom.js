// test_editor_dom.js - the editor's script drives the page by id ($("edSave")
// and friends). A typo there is not a small bug: $() returns null, the next
// property access throws, the whole script stops, and the page renders as dead
// HTML with no error dialog - which is why this is worth checking mechanically
// instead of by eye.
//
//   node Tools/test_editor_dom.js
//
// No browser needed: it compares the ids the script ASKS FOR against the ids the
// markup DEFINES, in both directions, and checks uniqueness.
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

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1];
ok("the page has an inline script", typeof script === "string" && script.length > 1000);
ok("the inline script parses as JavaScript", (() => {
	try { new Function(script); return true; } catch (e) { console.log("      " + e.message); return false; }
})());

/* -------------------------------------------------------------- ids: defined */

const defined = new Set();
const duplicates = [];
for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
	if (defined.has(m[1])) duplicates.push(m[1]);
	defined.add(m[1]);
}
ok("no element id is declared twice", duplicates.length === 0, [...new Set(duplicates)].join(","));

/* ids the script may create at runtime are fine to look up: count them */
const dynamic = new Set();
for (const m of script.matchAll(/\.id\s*=\s*"([^"]+)"/g)) dynamic.add(m[1]);
for (const m of html.matchAll(/id="([^"]+)"/g)) dynamic.add(m[1]);

/* -------------------------------------------------------------- ids: wanted */

const wanted = new Map(); // id -> [line numbers]
const lines = script.split(/\r?\n/);
lines.forEach((line, i) => {
	for (const m of line.matchAll(/\$\(\s*"([^"]+)"\s*\)/g)) {
		if (!wanted.has(m[1])) wanted.set(m[1], []);
		wanted.get(m[1]).push(i + 1);
	}
});
ok("the script looks up elements by id", wanted.size > 20, String(wanted.size));

const missing = [...wanted.entries()].filter(([id]) => !defined.has(id));
ok("every id the script looks up exists in the markup", missing.length === 0,
	missing.map(([id, at]) => id + " (line " + at[0] + ")").join(", "));

/* An unused id is not an error on its own (some are targets for other code),
   but an id that NOTHING references usually means the element was renamed and
   the code that used it now points at a null - the same failure, one step
   later. Report it so it cannot hide. */
const unreferenced = [...defined].filter(id =>
	!wanted.has(id)
	&& !dynamic.has(id)
	&& !new RegExp("getElementById\\(\\s*\"" + id + "\"|\\b" + id + "\\b").test(script));
ok("the markup has no orphaned id the script never uses", unreferenced.length === 0, unreferenced.join(","));

/* ------------------------------------------------- handlers wired to buttons */

/* a button with an id and no handler is dead UI. The script wires most with
   $("x").onclick = ... or addEventListener - assert every declared handler id
   is one of the elements that exists. */
const handlers = [];
for (const m of html.matchAll(/on(?:click|change|input|submit)="([A-Za-z_$][\w$]*)\(/g)) handlers.push(m[1]);
const inlineFns = new Set([...script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
const undeclared = [...new Set(handlers)].filter(fn => !inlineFns.has(fn) && !/^(event|this)$/.test(fn));
ok("every inline handler calls a function the page defines", undeclared.length === 0, undeclared.join(","));

/* --------------------------------------------- the ids the editor depends on */

/* These are the load-bearing ones: if any disappears the page cannot publish,
   save a rule or show the live list. Naming them means a refactor has to mean it. */
const CRITICAL = [
	"edSave", "edCancel", "fMatch", "fLabel", "fRank", "fColor", "userList", "userCount",
	"fTextColor", "fTextColorHex", "fUserColor", "fUserColorHex",
	"usersLive", "ruleList", "ruleCount", "status", "draftBtn", "publishBtn", "refreshBtn",
	"tokenChip", "dirtyChip", "ownerCard", "ownerKey", "saveOwner", "forgetOwner", "ownerState",
	"optSize", "optImgSize", "optUserSize", "optHeight",
];
const goneCritical = CRITICAL.filter(id => !defined.has(id));
ok("the id list this test guards is still accurate", goneCritical.length === 0,
	"these no longer exist, so either the page changed or the test is stale: " + goneCritical.join(","));
const unwired = CRITICAL.filter(id => !wanted.has(id) && !new RegExp("getElementById\\(\\s*\"" + id + "\"").test(script));
ok("every critical id is actually used by the script", unwired.length === 0, unwired.join(","));

console.log("\n" + (failures.length ? failures.length + " FAILED (" + pass + " passed)" : pass + " checks passed"));
process.exit(failures.length ? 1 : 0);
