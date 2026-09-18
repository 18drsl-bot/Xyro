// test_contract.js - the tag editor (index.html), the script (xyro.lua) and the
// published file (nametags.json) have to agree about the same vocabulary. When
// they drift, nothing crashes: a field the script never reads just sits in the
// file, a rank the editor offers silently does nothing, and both look like
// "the site does not match the game".
//
//   node Tools/test_contract.js
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
const lua = fs.readFileSync(path.join(ROOT, "xyro.lua"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const worker = fs.readFileSync(path.join(ROOT, "api", "worker.js"), "utf8");
const file = JSON.parse(fs.readFileSync(path.join(ROOT, "nametags.json"), "utf8"));

const block = (src, start, end) => {
	const i = src.indexOf(start);
	if (i < 0) return "";
	const j = src.indexOf(end, i + start.length);
	return j < 0 ? src.slice(i) : src.slice(i, j);
};

/* ------------------------------------------------------------- vocabularies */

// options the script understands (ntApplyOptions reads o.<field>)
const scriptOpts = new Set([...block(lua, "local function ntApplyOptions", "\nend").matchAll(/o\.([a-zA-Z_]+)/g)].map(m => m[1]));
// options the editor can write (the object readOptions returns)
const editorOpts = new Set([...block(html, "function readOptions()", "\n}").matchAll(/^\s*([a-zA-Z_]+):/gm)].map(m => m[1]));
// the script can also carry options with no UI on purpose - the editor must
// preserve them, which it does by merging over cfg.options instead of replacing
const PRESERVED_OPTS = ["infoEvery", "collapseEvery", "gifMaxFrames", "staffOnly"];

ok("the script's option list was found", scriptOpts.size > 10, [...scriptOpts].join(","));
ok("the editor's option list was found", editorOpts.size > 10, [...editorOpts].join(","));

const optsMissingFromEditor = [...scriptOpts].filter(o => !editorOpts.has(o) && !PRESERVED_OPTS.includes(o));
ok("every script option is either editable in the site or deliberately UI-less", optsMissingFromEditor.length === 0, optsMissingFromEditor.join(","));

const optsMissingFromScript = [...editorOpts].filter(o => !scriptOpts.has(o));
ok("the site cannot write an option the script ignores", optsMissingFromScript.length === 0, optsMissingFromScript.join(","));

// rule fields
const scriptRuleFields = new Set([...lua.matchAll(/rule\.([a-zA-Z_]+)/g)].map(m => m[1]));
const editorRuleFields = new Set([
	...block(html, "function editorTag()", "\n}").matchAll(/^\s*([a-zA-Z_]+):/gm),
].map(m => m[1]));
for (const m of block(html, "$(\"edSave\").onclick", "$(\"edCancel\")").matchAll(/clean\.([a-zA-Z_]+)\s*=/g)) editorRuleFields.add(m[1]);

ok("the script's rule field list was found", scriptRuleFields.size > 10, [...scriptRuleFields].join(","));
ok("the editor's rule field list was found", editorRuleFields.size > 8, [...editorRuleFields].join(","));

// match/label/color are the identity fields and are handled explicitly, not as
// clean.<field>
const identity = ["match", "label", "color"];
const rulesMissingFromScript = [...editorRuleFields].filter(f => !scriptRuleFields.has(f) && !identity.includes(f));
ok("every rule field the site writes is read by the script", rulesMissingFromScript.length === 0, rulesMissingFromScript.join(","));

// per-rule overrides the script supports but the site keeps only from the loaded
// file: they must survive an edit (Object.assign over prev), which is asserted
// below by reading the code rather than by listing them here.
ok("a rule keeps fields the editor has no input for", /const clean = Object\.assign\(\{\}, prev, \{/.test(html), "edSave no longer merges over prev");

// every rank the editor offers must be one the script resolves AND has artwork
const rankOptions = [...block(html, '<select id="fRank"', "</select>").matchAll(/value="([a-z]+)"/g)].map(m => m[1]);
const scriptRanks = new Set([...block(lua, "local NT_RANK_COLORS = {", "\n}").matchAll(/^\s*([a-z]+)\s*=/gm)].map(m => m[1]));
ok("the editor offers ranks", rankOptions.length > 3, rankOptions.join(","));
ok("every rank the site offers is one the script resolves", rankOptions.every(r => scriptRanks.has(r)),
	rankOptions.filter(r => !scriptRanks.has(r)).join(","));
ok("...and every rank the script resolves can be picked in the site", [...scriptRanks].every(r => rankOptions.includes(r)),
	[...scriptRanks].filter(r => !rankOptions.includes(r)).join(","));
ok("every offered rank has a pre-tinted seal on disk", rankOptions.every(r => fs.existsSync(path.join(ROOT, "media", "seal_" + r + ".png"))),
	rankOptions.filter(r => !fs.existsSync(path.join(ROOT, "media", "seal_" + r + ".png"))).join(","));

/* --------------------------------------- the published file fits the schema */

const unknownOpts = Object.keys(file.options || {}).filter(k => !scriptOpts.has(k));
ok("the published options are all fields the script reads", unknownOpts.length === 0, unknownOpts.join(","));

const unknownRules = [];
file.tags.forEach((t, i) => {
	for (const k of Object.keys(t)) if (!scriptRuleFields.has(k) && !identity.includes(k)) unknownRules.push("#" + (i + 1) + "." + k);
});
ok("the published rules are all fields the script reads", unknownRules.length === 0, unknownRules.join(","));

const badRanks = file.tags.filter(t => t.rank && !scriptRanks.has(t.rank));
ok("the published rules use ranks the script resolves", badRanks.length === 0, badRanks.map(t => t.match + "=" + t.rank).join(","));

/* --------------------------- the site's static defaults match the script's */

function luaDefault(name) {
	const m = block(lua, "local ntOpts = {", "\n}").match(new RegExp("^\\t" + name + "\\s*=\\s*([^,]+),", "m"));
	return m ? m[1].trim() : null;
}
const staticDefaults = [
	["optSize", "size"],
	["optUserSize", "userSize"],
	["optHeight", "height"],
	["optImgSize", "imageSize"],
];
for (const [id, opt] of staticDefaults) {
	const tag = html.match(new RegExp('<input id="' + id + '"[^>]*>'));
	const value = tag ? (tag[0].match(/value="(\d+)"/) || [])[1] : null;
	const want = luaDefault(opt);
	ok("the page's default for " + opt + " matches the script's (" + want + ")", value === null || value === want,
		"page " + value + " vs script " + want);
}

/* ------------------ the two fixes that stop a stale copy from sticking ---- */

/* staff/ranks/blacklist must be rebuilt from each payload, not added to:
   additive application is why an unbanned account stayed blocked and a changed
   rank kept its old seal on a running client. */
ok("the script can wipe a table in place", /local function fbClear\(t\)/.test(lua), "no fbClear");
ok("admins are rebuilt from the payload", /if hasAdmins then\r?\n\t\tfbClear\(ADMIN_IDS\)/.test(lua), "");
ok("rank tiers are rebuilt from the payload", /fbClear\(H\.NT_RANKS\)/.test(lua), "");
ok("the blacklist is rebuilt from the payload", /fbClear\(H\.BLACKLIST_IDS\)/.test(lua) && /fbClear\(H\.BLACKLIST_NAMES\)/.test(lua), "");
ok("a section missing from the payload is left alone", /local hasAdmins = type\(data\.ids\) == "table"/.test(lua) && /A section that is ABSENT from the payload is left untouched/.test(lua), "");
ok("nothing claims additive application any more", !/additive: entries deleted from Firebase stay admin/.test(lua), "stale comment");

/* a CDN copy that disagrees with what is applied gets settled by the API */
ok("the script remembers what it applied", /local ntAppliedText = nil/.test(lua) && /ntAppliedText = text/.test(lua), "");
ok("a disagreeing CDN copy is confirmed against the API", /if text and ntLastSource ~= "api" and \(ntAppliedText == nil or text ~= ntAppliedText\) then/.test(lua), "");
ok("...and the correction names itself in the source line", /api \(corrected a stale " \.\. ntLastSource \.\. " copy\)/.test(lua), "");
ok("a failed confirmation still applies the copy (fail open)", /if fromApi and fromApi ~= text then/.test(lua), "");
ok("the source is reported to the user", /" via " \.\. ntLastSource/.test(lua), "");

/* ---------------------------- one presence window, three implementations --- */

/* If these drift, a player is "online" in one place and gone in another, and
   every report of it sounds like "the website does not match the game". */
function windowOf(src, name) {
	const m = src.match(new RegExp("^[ \\t]*(?:local\\s+|const\\s+)" + name + "\\s*=\\s*(\\d+)", "m"));
	return m ? Number(m[1]) : null;
}
const luaWindow = windowOf(lua, "NT_BEAT_WINDOW");
const siteWindow = windowOf(html, "PRESENCE_WINDOW");
const apiWindow = windowOf(worker, "PRESENCE_WINDOW");
ok("all three presence windows were found", luaWindow && siteWindow && apiWindow,
	[ luaWindow, siteWindow, apiWindow ].join("/"));
ok("the script, the site and the API agree on how long a beat stays live (" + luaWindow + "s)",
	luaWindow === siteWindow && luaWindow === apiWindow,
	"script " + luaWindow + ", site " + siteWindow + ", api " + apiWindow);

// the API's own listing must sort by recency. (a, b) => b - a on username keys
// is NaN, and a NaN comparator sorts nothing while looking correct.
ok("the API lists the newest beat first", /\.sort\(\(a, b\) => fresh\[b\] - fresh\[a\]\)/.test(worker),
	"comparator is not beat-based");
ok("...and not by subtracting username strings", !/Object\.keys\(fresh\)\.sort\(\(a, b\) => b - a\)/.test(worker), "NaN comparator is back");

// the site must age a player out on the beat's own clock, not the poll's
ok("the site dates a beat by the beat, not by the poll that read it",
	/seenUsers\[n\] = sec \* 1000;/.test(html) && !/if \(n && n\.length < 40 && sec && nowSec - sec <= PRESENCE_WINDOW\) seenUsers\[n\] = Date\.now\(\);/.test(html),
	"the editor still re-stamps old beats as now");

/* green has to mean the same thing on both sides: "the game is drawing a tag" */
ok("the site counts a catch-all as a tag (the game does)", /const tagged = ruleMatch \|\| star;/.test(html), "catch-all users would read as untagged");
ok("...and the dot follows that, not the named-rule match alone",
	/\(tagged \? "#3ddc84" : "#e5b83c"\)/.test(html), "dot still uses the named-rule match");
ok("the rule match is prefix-based like ntRuleFor", /return m !== "" && m !== "\*" && n\.startsWith\(m\);/.test(html), "");
ok("the site says display-name matches are invisible to it", /only matches their display name cannot be seen from here/.test(html), "");

console.log("\n" + (failures.length ? failures.length + " FAILED (" + pass + " passed)" : pass + " checks passed"));
process.exit(failures.length ? 1 : 0);
