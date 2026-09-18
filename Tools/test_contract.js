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

/* The other direction is the one that hides features: the script honours a
   per-rule field, the form has no input for it, so it is unreachable from the
   site and looks like the site "not having" a setting the game supports. Each
   entry below is a deliberate omission - a NEW script field not listed here
   fails this check, which is the point. */
const RULE_FIELDS_WITHOUT_UI = [
	"font", "height", "imageSize", "userSize",
	"userBoxColor", "userBoxRadius", "userBoxStroke", "userBoxTransparency",
];
const unreachable = [...scriptRuleFields].filter(f =>
	!editorRuleFields.has(f) && !identity.includes(f) && !RULE_FIELDS_WITHOUT_UI.includes(f));
ok("no per-rule setting is honoured by the script but unreachable from the site",
	unreachable.length === 0, unreachable.join(","));

/* the two text colours are per-rule AND global, like the game resolves them */
ok("the rule editor can set the name text colour", editorRuleFields.has("textColor"), "no textColor input");
ok("the rule editor can set the @username colour", editorRuleFields.has("userColor"), "no userColor input");
ok("...and a blank rule value falls back to the global option, as the game does",
	/function nameColorOf\(t\)/.test(html) && /function userColorOf\(t\)/.test(html)
	&& /hex6\(t && t\.textColor\) \|\| \$\("optTextColor"\)\.value/.test(html)
	&& /hex6\(t && t\.userColor\) \|\| \$\("optUserColor"\)\.value/.test(html),
	"the resolvers are missing or no longer fall back to the option");
ok("both previews use that one resolver, so they cannot disagree",
	(html.match(/nameColorOf\(t\)/g) || []).length >= 2 && (html.match(/userColorOf\(t\)/g) || []).length >= 2,
	"a preview stopped using the shared resolver");
ok("the global name colour is really shown in the preview",
	/\$\("pvLabel"\)\.style\.color = nameColorOf\(t\)/.test(html) && /\$\("pvUser"\)\.style\.color = userColorOf\(t\)/.test(html),
	"the options are published but never previewed");
ok("a blank hex box survives a save as the global default",
	/if \(t\.textColor\) clean\.textColor = t\.textColor; else delete clean\.textColor;/.test(html)
	&& /if \(t\.userColor\) clean\.userColor = t\.userColor; else delete clean\.userColor;/.test(html),
	"edSave drops or keeps the field wrongly");
ok("changing a rule colour forces a rebuild in game",
	/tostring\(rule\.textColor or ""\)/.test(lua) && /tostring\(rule\.userColor or ""\)/.test(lua),
	"the rebuild signature does not carry the text colours");

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

/* ------------------- one nametag ingress, three implementations ----------- */

/* The rules and the tag artwork are hosted by the API now, and all three sides
   have to name the SAME paths on it. The failure this guards against is quiet:
   one component keeps reading a CDN, so the game and the editor disagree about
   a tag that was changed, and every report of it sounds like "the website does
   not match the game" again. */
ok("the API serves the rules at /nametags", /NAMETAGS_FILE = "nametags\.json"/.test(worker) && worker.includes('path === "/nametags"'), "");
ok("the API serves the artwork at /media/<file>", worker.includes("serveMedia(env, ctx, url, media[1])"), "");
ok("the API keeps its edge-cache escape hatch", worker.includes('url.searchParams.has("fresh")'), "");
ok("the API never fetches from jsDelivr", !/["'`]https?:\/\/[^"'`]*jsdelivr/i.test(worker), "jsDelivr is back in the Worker");

ok("the script asks the API for the rules", lua.includes('H.ntApiUrl("nametags"'), "");
ok("...and for the artwork", lua.includes('H.ntApiUrl("media/" .. file'), "");
ok("every seal and badge URL goes through that one builder", !!block(lua, "local function ntMediaUrl", "\nend") && /ntMediaUrl\("seal_" \.\. badgeRank/.test(lua) && /ntMediaUrl\("verified_seal_blue\.png"/.test(lua), "");
ok("no separate seal URL base survives to drift from it", !/NT_SEAL_URL_BASE/.test(lua) && !/NT_BADGE_URL/.test(lua), "");

/* order matters: the API has to be TRIED before the CDN fallbacks, or a stale
   edge copy wins on a client that could have had the file */
const ntFetchBlock = block(lua, "local function ntFetch(manual)", "\nlocal function ntRuleFor");
ok("the script tries the API before any CDN fallback",
	ntFetchBlock.indexOf('H.ntApiUrl("nametags"') >= 0 &&
		ntFetchBlock.indexOf('H.ntApiUrl("nametags"') < ntFetchBlock.indexOf("NT_FALLBACK_URL") &&
		ntFetchBlock.indexOf("NT_FALLBACK_URL") < ntFetchBlock.indexOf("NT_RAW_URL"),
	"API at " + ntFetchBlock.indexOf('H.ntApiUrl("nametags"') + ", raw at " + ntFetchBlock.indexOf("NT_FALLBACK_URL") + ", cdn at " + ntFetchBlock.indexOf("NT_RAW_URL"));

ok("the editor asks the API for the rules", html.includes('NT_BASE + "/nametags"'), "");
ok("...and for the artwork", html.includes('NT_BASE + "/media/"'), "");
ok("no hardcoded CDN media URL is left in the editor", !/cdn\.jsdelivr\.net\/gh\/vertxxy-1\/Xyro@main\/media/.test(html), "");
const fetchBlock = block(html, "async function fetchConfig(opts)", "\nfunction load()");
ok("the editor tries the API before raw/CDN for a read",
	fetchBlock.indexOf("hostedRules") >= 0 && fetchBlock.indexOf("hostedRules") < fetchBlock.indexOf("rawConfig()"),
	"hosted at " + fetchBlock.indexOf("hostedRules") + ", raw at " + fetchBlock.indexOf("rawConfig()"));
ok("and waits for api.json before the first read, so boot is not a GitHub read",
	/await apiReady;/.test(html) && /const apiReady = \(async function followApi\(\)/.test(html), "");

/* ---------------------- publishing: the editor and the Worker agree ------ */

/* The sha header is the contract that makes a publish safe: if one side renames
   it, the editor silently publishes WITHOUT the sha and a stale tab starts
   clobbering newer revisions again - the failure is invisible until someone
   loses an edit. */
ok("the API returns the blob sha as x-xyro-sha", worker.includes('"x-xyro-sha": file.sha'), "");
ok("...and exposes it to the browser", worker.includes('"access-control-expose-headers": "x-xyro-sha'), "");
ok("the editor reads the same header name", html.includes('res.headers.get("x-xyro-sha")'), "");
ok("the editor sends it back as ?sha=", html.includes('"?sha=" + encodeURIComponent(shaToSend)'), "");
ok("the Worker honours that sha (GitHub 409s a stale write)", worker.includes('url.searchParams.get("sha")') && /put\.status === 409 \? 409 : 502/.test(worker), "");
ok("the editor asks /nametags/check before trusting a key", html.includes('"/nametags/check"') && worker.includes('path === "/nametags/check"'), "");
ok("the Worker's check route changes nothing", /async function checkPublishReady\(env\)/.test(worker) && !/fb\(env/.test(block(worker, "async function checkPublishReady", "\n}\n\n/** PUT /nametags")), "");
ok("a publish key is accepted besides the owner key", /function publishKeyResponse\(req, url, env\)/.test(worker) && worker.includes("env.XYRO_PUBLISH_KEY"), "");
/* the publish-only key must NOT be a second admin key */
ok("the publish key is not wired into the admin routes",
	!/function adminKeyResponse[\s\S]{0,400}XYRO_PUBLISH_KEY/.test(worker),
	"XYRO_PUBLISH_KEY leaked into adminKeyResponse");

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
