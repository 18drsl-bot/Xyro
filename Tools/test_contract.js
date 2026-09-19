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

/* Every source is read with its newlines normalised. These tests slice the real
   files between two markers, and on a Windows checkout (core.autocrlf) the same
   file is CRLF while the markers are written with \n - which silently turned a
   slice into "the rest of the file" and made an assertion look at code it was
   never meant to see. Normalising here means the assertions describe content,
   not the line endings of whatever machine happens to run them. */
const readText = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const ROOT = path.join(__dirname, "..");
const lua = readText("xyro.lua");
const html = readText("index.html");
const worker = readText(path.join("api", "worker.js"));
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

/* A badge that cannot be REDOWNLOADED is a badge that is stuck: game:HttpGet
   returns the body for a 404 too, so the API's "no such repo file" text used to
   be saved as seal_<rank>.png, and the disk-first branch then served it forever
   while drawing nothing (a loaded asset, so the verifier never fell back). The
   guard is the predicate below being checked BEFORE anything is written. */
const wholeBlock = block(lua, "local function ntImageLooksWhole", "\nend");
ok("the script has a whole-image predicate", !!wholeBlock, "");
ok("...that knows the PNG signature and end marker",
	wholeBlock.includes('"\\137PNG\\13\\10\\26\\10"') && wholeBlock.includes('find("IEND", 1, true)'), "");
ok("...and the JPEG and GIF ones",
	wholeBlock.includes('"\\255\\216"') && wholeBlock.includes('"\\255\\217"') && wholeBlock.includes('"GIF87a"'), "");
ok("a download is refused unless it is a whole image",
	/assert\(ntImageLooksWhole\(data\), "download was not a whole image"\)/.test(lua), "");
ok("...with a floor, so an empty or one-byte body cannot pass",
	/local NT_IMAGE_MIN = 24/.test(lua) && /#data < NT_IMAGE_MIN/.test(lua), "");
const buster = Number(((lua.match(/local sealBuster = "\?v=(\d+)"/) || [])[1]) || 0);
ok("the seal buster is bumped past every seal that has been added", buster >= 15, "v" + buster);
ok("...and the comment says that adding a seal is what bumps it",
	/BUMPED when a seal is ADDED/.test(lua), "");

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
ok("the editor reads the rules from the API and nowhere else",
	fetchBlock.includes("hostedRules") && !/rawConfig|apiConfig\(\)|apiConfigWhenReady/.test(fetchBlock), block(html, "async function fetchConfig(opts)", "\nfunction load()"));
ok("...and says so when there is no API, instead of falling back somewhere else",
	/no API is configured - set api\.url in api\.json/.test(fetchBlock), "");
/* The browser-side GitHub write is gone, and this is the part that kept the
   token field alive: fetchConfig could ask for a blob sha to PUT with. With no
   token in the page there is nothing to write with, so a sha request surviving
   here would be a credential the page can no longer send. */
ok("and there is no longer a path that needs a GitHub blob sha",
	!/github\.com\/repos|Authorization.*Bearer|LS_TOKEN|getToken\(\)/.test(html),
	["getToken", "LS_TOKEN", "github.com/repos", "Authorization"]
		.filter(s => html.includes(s)).join(", "));
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
ok("the Worker honours that sha (GitHub 409s a stale write)", worker.includes('url.searchParams.get("sha")') && /out\.status === 409 \? 409 : 502/.test(worker), "");
/* The same guard, in the store that needs no token. Both have to refuse a stale
   write, or "publishing without a token" would quietly mean "publishing can
   clobber a newer revision" - the exact bug the sha was introduced to stop. */
ok("the rules database refuses a stale write with the same single compare-and-set",
	/ON CONFLICT\(id\) DO UPDATE[\s\S]{0,200}WHERE rules\.rev = \?/.test(worker) && /meta\.changes/.test(worker), "");
ok("...and hands its revision out in the same header the editor already sends back",
	worker.includes('"x-xyro-sha": "d1-" + stored.rev') && /\^d1-\(\\d\+\)\$/.test(worker), "");
ok("publishing needs no repo token once the database is bound",
	worker.includes("const hasDb = !!(env.xyro_tags") && !worker.includes("publishing through the API needs GH_TOKEN"), "");
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

/* ---------------------- the blacklist: one list, three sides ------------ */

/* The script enforces the list, the site edits it and the Worker brokers it.
   The route shape is the contract: a rename on one side means the site reports
   a failure while nothing is broken, or - worse - a block that never lands
   while the page says it did. */
ok("the Worker serves the blacklist as a map",
	worker.includes('path === "/blacklist"') && worker.includes("blacklist: list") && /function blacklistMap/.test(worker), "");
ok("...and edits one entry at /blacklist/<who> with POST and DELETE",
	/bl = path\.match/.test(worker) && worker.includes('req.method === "POST" || req.method === "DELETE"') && /const who = decodeURIComponent\(bl\[1\]\)/.test(worker), "");
ok("editing needs the OWNER key, never the public client key",
	/deliberately not the client key|a client key is public/.test(worker) && worker.includes("adminKeyResponse(req, url, env)"), "");
ok("the site names the same routes and methods",
	html.includes('NT_BASE + "/blacklist"') && html.includes('NT_BASE + "/blacklist/" + encodeURIComponent(who)') && /method: remove \? "DELETE" : "POST"/.test(html), "");
ok("...sending the reason as the body, which is what the script prints",
	/body: remove \? undefined : why/.test(html) && worker.includes("reason.slice(0, 200)"), "");
ok("both sides accept the same key shapes",
	worker.includes("/^[A-Za-z0-9_]{1,32}$/") && html.includes("/^[A-Za-z0-9_]{1,32}$/"), "");
ok("the script refuses a blacklisted account instead of only hiding its tag",
	/function fbIsBlacklisted/.test(lua) && /H\.blacklistShutdown/.test(lua) && /is on the Xyro blacklist, so the script will not run here/.test(lua), "");

/* --- a bot edits the same route pair the editor does -------------------- */

/* A Discord bot is the third writer. It has to name the same routes, the same
   methods and the same header as the Worker, and it must NOT go through GitHub:
   the Worker serves its database first, so a repo commit from a bot changes what
   git history says and nothing about what players see. */
const bot = fs.readFileSync(path.join(ROOT, "api", "nametags-client.js"), "utf8");
ok("the bot client reads and writes through the Worker, not the GitHub API",
	!/api\.github\.com/.test(bot) && /"\/nametags\?fresh=1"/.test(bot) && /method/.test(bot), "");
ok("it sends the owner key in x-api-key, the header the Worker reads",
	/"x-api-key": key/.test(bot) && worker.includes('req.headers.get("x-api-key")'), "");
ok("it guards its write with ?sha=, like the editor",
	/\/nametags" \+ \(rev \? "\?sha=" \+ encodeURIComponent\(rev\)/.test(bot) && worker.includes('url.searchParams.get("sha")'), "");
ok("and treats a 409 as a race to re-read, not a failure to report",
	/err\.code = "conflict"/.test(bot) && /err\.code === "conflict"/.test(bot), "");
ok("the bot's blacklist calls match the Worker's routes and methods",
	bot.includes('call("POST", "/blacklist/"') && bot.includes('call("DELETE", "/blacklist/"') && worker.includes('req.method === "POST" || req.method === "DELETE"'), "");
ok("and it documents the trap it exists to avoid (a repo commit reaching nobody)",
	/WHAT NOT TO DO/.test(bot) && /nametags\.json/.test(bot) && /mirror/.test(bot), "");

/* --- the Discord bot on Cloudflare names the same routes ---------------- */

/* The bot Worker is a third consumer of the same API, deployed separately. It
   has to agree with the Xyro Worker about routes, methods and the header, or it
   fails only in production, only for a staff command, and only in Discord - the
   least debuggable place there is. */
const botWorker = fs.readFileSync(path.join(ROOT, "api", "bot", "bot-worker.js"), "utf8");
const botCommands = fs.readFileSync(path.join(ROOT, "api", "bot", "commands.js"), "utf8");
const botToml = fs.readFileSync(path.join(ROOT, "api", "bot", "wrangler.toml"), "utf8");
ok("the bot reads and writes the same rules routes",
	botWorker.includes('"/nametags?fresh=1"') && botWorker.includes('"/nametags"') && botWorker.includes('"?sha="'), "");
ok("the bot sends the owner key in x-api-key, the header the Worker reads",
	/"x-api-key": key/.test(botWorker) && worker.includes('req.headers.get("x-api-key")'), "");
ok("the bot's blacklist calls use the Worker's methods",
	botWorker.includes('call("POST", "/blacklist/"') && botWorker.includes('call("DELETE", "/blacklist/"') && worker.includes('req.method === "POST" || req.method === "DELETE"'), "");
ok("the bot reads the revision from the same header the API sends",
	/x-xyro-sha/.test(botWorker) && worker.includes('"x-xyro-sha"'), "");
/* Routing is a switch on a name Discord sends, so a name in commands.js that
   bot-worker.js does not handle is offered to users and then answers "Unknown
   command" - the test suite drives every one of them, this just keeps the two
   files in step as text. */
const registeredNames = [...botCommands.matchAll(/^\t\tname: "([a-z]+)",$/gm)].map(m => m[1]);
ok("every registered command is handled in the bot Worker",
	registeredNames.length > 0 && registeredNames.every(n => botWorker.includes('name === "' + n + '"')),
	registeredNames.join(", ") + " / handled: " + (botWorker.match(/name === "[a-z]+"/g) || []).join(" "));
ok("the bot has its own wrangler config, so it cannot redeploy the players' API",
	/name = "xyro-bot"/.test(botToml) && /env\.XYRO_ADMIN_KEY|XYRO_ADMIN_KEY/.test(botToml), "");
ok("and it says the bot TOKEN must not live on the Worker", /NOT here, deliberately/.test(botToml), "");

/* --- tag artwork: three sides, one route ------------------------------- */

/* The editor asks HEAD /media/<file> to decide whether a picture is already
   being served, and that answer is what keeps it from embedding base64 into
   the rules. If the Worker only answered GET, the probe would 405, the editor
   would fall through to the embed branch, and nothing would look broken - the
   rules would simply get heavier again and every player would pay for it on
   every refresh. That is exactly how a 1.29 MB image ended up inside a 1.72 MB
   rules document while the same file already sat in media/. */
ok("the editor asks the media route whether a file is already served",
	/mediaAlreadyServed/.test(html) && html.includes('method: "HEAD"'), "");
ok("and the Worker answers HEAD on that route",
	/media && \(req\.method === "GET" \|\| req\.method === "HEAD"\)/.test(worker), "");
ok("a HEAD reply carries no body",
	worker.includes('if (req.method === "HEAD") return new Response(null'), "");
ok("the script maps repo media onto that same route instead of a CDN",
	/function ntApplyImage/.test(lua) && lua.includes("H.ntApiUrl(file, query)"), "");
ok("no rule in the shipped file carries an inline image",
	JSON.stringify(file).length < 256 * 1024 && !/data:image\//.test(JSON.stringify(file)),
	JSON.stringify(file).length + " bytes");

/* ------------------------------------------------------ the worker-to-worker hop */

/* Cloudflare refuses a Worker fetching another Worker on the same zone (error
   1042), which arrives as "404 error code: 1042" - indistinguishable from a
   missing route. The bot and the tag API share one workers.dev subdomain, so
   the bot reaches the API through a service binding. The binding names the
   OTHER Worker by `service`, and a rename on either side breaks it silently:
   deploy succeeds, the binding table looks plausible, and every command fails
   at request time. */
const botSrc = fs.readFileSync(path.join(ROOT, "api", "bot", "bot-worker.js"), "utf8");
const apiToml = fs.readFileSync(path.join(ROOT, "api", "wrangler.toml"), "utf8");
const apiName = (apiToml.match(/^name\s*=\s*"([^"]+)"/m) || [])[1];
const svcName = (botToml.match(/\[\[services\]\][\s\S]*?^service\s*=\s*"([^"]+)"/m) || [])[1];
const svcBinding = (botToml.match(/\[\[services\]\][\s\S]*?^binding\s*=\s*"([^"]+)"/m) || [])[1];
ok("the bot declares a service binding", !!svcName && !!svcBinding, "service=" + svcName + " binding=" + svcBinding);
ok("...naming the tag API by its actual worker name", svcName === apiName, "binding targets " + svcName + ", api/wrangler.toml is " + apiName);
ok("...and the code reads that binding", botSrc.includes("env." + svcBinding), "env." + svcBinding);
ok("the bot prefers the binding over the same-zone URL",
	/svc\s*=\s*env\.\w+/.test(botSrc) && botSrc.includes("fetchImpl ||"), "");

/* ------------------------------------------------ the presence keeper's bounds */

/* presence.js is the one file here that must run OUTSIDE Cloudflare, with no
   build step: plain CommonJS, no dependencies, no bundler. It is easy to break
   by "tidying" it - an import statement, a require of discord.js, or an export
   keyword would all look fine in a diff and fail only when someone runs it on
   the host that is supposed to keep the bot online. */
const presenceSrc = fs.readFileSync(path.join(ROOT, "api", "bot", "presence.js"), "utf8");
ok("presence.js is plain CommonJS, so node can run it with no build",
	presenceSrc.includes("module.exports") && !/^\s*(import|export)\s/m.test(presenceSrc), "");
/* Built-ins only. `require("fs")` is fine; `require("discord.js")` is the trap -
   it works on the dev machine and then needs an install step on the host that
   is meant to just keep a socket open. */
const BUILTINS = ["fs", "path", "os", "crypto", "url", "util", "events", "net", "tls", "http", "https", "zlib", "node:fs", "node:path", "node:os", "node:crypto"];
const presenceRequires = (presenceSrc.match(/require\(\s*["']([^"']+)["']\s*\)/g) || [])
	.map((call) => call.match(/["']([^"']+)["']/)[1]);
ok("presence.js requires only node built-ins, so there is nothing to install",
	presenceRequires.every((name) => BUILTINS.indexOf(name) !== -1),
	presenceRequires.join(", ") || "none");
ok("presence.js is never the Worker's entry point",
	!/main\s*=\s*"presence\.js"/.test(botToml), "");
ok("presence.js only holds a session, it does not talk to the tag API",
	!/nametags|XYRO_ADMIN_KEY|x-api-key/.test(presenceSrc), "");

/* The offline state is the single most confusing thing about this deployment,
   and the two places someone looks are the Worker and the bot guide. If either
   stops explaining it, the grey dot reads like a bug again. */
ok("the Worker says why a Worker-hosted bot has no presence",
	/offline/i.test(botSrc) && /presence\.js/.test(botSrc), "");
const botDoc = fs.readFileSync(path.join(ROOT, "DISCORD-BOT.md"), "utf8");
ok("the bot guide documents the green dot and where it can run",
	botDoc.includes("api/bot/presence.js") && /Do not deploy it to Cloudflare/i.test(botDoc), "");
ok("the bot guide does not promise presence from the Worker",
	!/needs no always-on host[^]*?presence works/i.test(botDoc), "");

/* The same dead end reaches the EDITOR, which is where it actually bit: a page
   with a GitHub token and no owner key published to the repo and said
   "Published". The guide is the only place that explains it, so it may not
   quietly lose the paragraph - the bot half alone would leave the trap live. */
const editorSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
/* The dead end used to be reachable two ways: the bot Worker fetching its own
   zone, and the editor publishing to GitHub while the database was the store.
   The editor half is closed by there being ONE route left - a publish either
   goes through the API with the owner key or it does not happen - so what this
   pins is that the route can never be chosen by a stale memory again. */
ok("the editor has exactly one publish route, decided by the key alone",
	/function publishRoute\(\) \{[\s\S]{0,200}?getOwnerKey\(\) && NT_BASE/.test(editorSrc) &&
	!/function publishRoute\(\) \{[\s\S]{0,300}?liveSha/.test(editorSrc), "");
ok("...and says why a publish cannot happen when the key is missing",
	/owner key needed to publish/.test(editorSrc) &&
	/owner key forgotten - Publish cannot write anywhere until a key is saved/.test(editorSrc), "");
ok("the bot guide explains the editor's version of the same trap",
	/The tag editor is not exempt from this/i.test(botDoc), "");

/* ------------------------------------------------ the tag's line spacing */

/* Row heights used to be the fixed pair 17/12 whatever the text size. That was
   fine at the old size-18 default, but raising the shipped Name size to 22 put a
   22px name in a 17px row: the two lines collided by ~2px while the pill still
   had 12px of unused padding, so "make the tag bigger" produced a tag that was
   bigger AND cramped. The rows now derive from the text sizes.

   The numbers are read OUT of the Lua rather than restated here, so editing the
   formula changes what is checked instead of leaving this asserting something
   about an older version of it. */
const rowConst = lua.match(/local NAME_H, USER_H = (\d+), (\d+)/);
const nameOffset = lua.match(/local nameRowH = math\.max\(NAME_H, math\.ceil\(nameSize \+ (\d+)\)\)/);
const userOffset = lua.match(/local userRowH = math\.max\(USER_H, math\.ceil\(userSize \+ (\d+)\)\)/);
const rowPad = lua.match(/if nameRowH \+ userRowH \+ (\d+) > height then/);
const heightClamp = lua.match(/local height = math\.clamp\(tonumber\(rule\.height\) or ntOpts\.height, (\d+), (\d+)\)/);
ok("the tag's rows are derived from the text sizes, not fixed constants",
	!!rowConst && !!nameOffset && !!userOffset && !!rowPad && !!heightClamp,
	"parsed: " + JSON.stringify({ rowConst: rowConst && rowConst[0], nameOffset: nameOffset && nameOffset[0] }));
ok("...so nothing sizes a row with the bare constant any more",
	!/0, NAME_H\)/.test(lua) && !/0, USER_H\)/.test(lua), "");

if (rowConst && nameOffset && userOffset && rowPad && heightClamp) {
	const NAME_H = Number(rowConst[1]);
	const USER_H = Number(rowConst[2]);
	const nOff = Number(nameOffset[1]);
	const uOff = Number(userOffset[1]);
	const pad = Number(rowPad[1]);
	const hMin = Number(heightClamp[1]);
	const hMax = Number(heightClamp[2]);

	/* the layout the script builds, as arithmetic */
	function measure(nameSize, userSize, askedHeight) {
		const nameRowH = Math.max(NAME_H, Math.ceil(nameSize + nOff));
		const userRowH = Math.max(USER_H, Math.ceil(userSize + uOff));
		let height = Math.min(hMax, Math.max(hMin, askedHeight));
		if (nameRowH + userRowH + pad > height) height = Math.min(nameRowH + userRowH + pad, 160);
		const nameTop = Math.floor((height - (nameRowH + userRowH)) / 2);
		const nameBottom = nameTop + nameRowH / 2 + nameSize / 2;
		const userTop = nameTop + nameRowH + userRowH / 2 - userSize / 2;
		return { gap: userTop - nameBottom, pad: height - (nameTop + nameRowH + userRowH), height: height };
	}

	/* every size the script allows (size 8-48, userSize 8-24, height 28-96) */
	let worst = { gap: Infinity, at: "" };
	let tight = 0;
	for (let nameSize = 8; nameSize <= 48; nameSize++) {
		for (let userSize = 8; userSize <= 24; userSize++) {
			for (let asked = hMin; asked <= hMax; asked += 4) {
				const m = measure(nameSize, userSize, asked);
				if (m.gap < worst.gap) worst = { gap: m.gap, at: nameSize + "/" + userSize + " h" + asked };
				if (m.gap < 0 || m.pad < 0) tight++;
			}
		}
	}
	ok("no legal tag size can make the name and @username lines collide",
		tight === 0, tight + " colliding combinations; worst line gap " + worst.gap.toFixed(1) + "px at " + worst.at);

	/* and the sizes actually shipped in nametags.json, which is what the answer
	   to "make the tags bigger" was judged on */
	const shipped = measure(Number(file.options.size) || 15, Number(file.options.userSize) || 10, Number(file.options.height) || 48);
	ok("the shipped tag has breathing room between its two lines (" + (Number(file.options.size) || 15) + "px name)",
		shipped.gap >= 0 && shipped.pad >= 0,
		"line gap " + shipped.gap.toFixed(1) + "px, pill padding " + shipped.pad + "px at size " + file.options.size + "/" + file.options.userSize);
}

/* --- the script never reads a field it did not assign --------------------- */
/* H is how the script's separate scopes share anything, and the sharing runs one
   way: one block exports H.foo, another scope reads it. A missing export does
   not throw at load - the read is simply nil, so the symptom is either a silent
   no-op or "attempt to call a nil value", never a sentence that names the
   cause. That is how a nametag helper once crashed, and how H.TextService left
   every pill width a character-count guess (a guess that is handed the font and
   ignores it, so the font option could not change a pill's width either).
   Checked mechanically, because reading 16k lines is not a strategy. */
{
	/* comments stripped CRLF-safely: `.` does not match a carriage return, so a
	   /--.*$/ without the m flag silently strips nothing on a Windows checkout */
	const code = lua.replace(/--(?!\[\[?|-).*$/gm, "");
	const assigned = new Set();
	let m;
	const decl = /function\s+H\.([A-Za-z_][A-Za-z0-9_]*)/g;
	while ((m = decl.exec(code))) assigned.add(m[1]);
	for (const line of code.split("\n")) {
		const eq = /(?<![=<>~])=(?!=)/.exec(line);
		if (!eq) continue;
		const re = /\bH\.([A-Za-z_][A-Za-z0-9_]*)/g;
		while ((m = re.exec(line.slice(0, eq.index)))) assigned.add(m[1]);
	}
	const read = new Set();
	const use = /\bH\.([A-Za-z_][A-Za-z0-9_]*)/g;
	while ((m = use.exec(code))) read.add(m[1]);
	const unassigned = [...read].filter(n => !assigned.has(n));
	ok("every H field the script reads is assigned somewhere (a missing export is nil, not an error)",
		unassigned.length === 0, unassigned.length + " never assigned: " + unassigned.join(", "));
	ok("...including the text service the pills measure their own width with",
		assigned.has("TextService") && /H\.TextService:GetTextSize\(/.test(lua), "");
}

/* --- every font the editor offers actually resolves in the script ---------- */
/* The script looks a font up through ntNormalize, which LOWERCASES its input, so
   the table's keys have to be lowercase as well. Written GothamBlack/Bangers/...
   every lookup missed and fell through to the fallback - so the font option was
   a silent no-op, and an invisible one, because the fallback is GothamBlack and
   GothamBlack is what the file asks for anyway. */
{
	const at = html.indexOf('id="optFont"');
	const body = at === -1 ? "" : html.slice(at, html.indexOf("</select>", at));
	const options = [];
	let m;
	const opt = /<option[^>]*>([^<]+)<\/option>/g;
	while ((m = opt.exec(body))) options.push(m[1].trim());

	const table = lua.slice(lua.indexOf("local NT_FONTS"), lua.indexOf("local function ntFont"));
	const keys = new Set();
	const key = /^\t([a-z0-9_]+)\s*=/gm;
	while ((m = key.exec(table))) keys.add(m[1]);

	const unresolved = options.filter(o => !keys.has(o.toLowerCase()));
	ok("every font the editor offers resolves in the script's font table (" + options.length + " options)",
		options.length >= 8 && unresolved.length === 0,
		unresolved.length + " unresolved: " + unresolved.join(", ") + " | keys seen: " + [...keys].join(", ") + " | options: " + options.join(", "));
	ok("...and the lookup normalises names the same way the keys are spelled",
		/NT_FONTS\[ntNormalize\(name\)\]/.test(lua), "");
}

/* --- four copies of every default, and they have to agree ------------------ */
/* A numeric option lives in four places: what the script falls back to when the
   file omits the key, what the form LOADS into the field when the key is absent,
   what the form PUBLISHES when the field is left blank, and the clamp that
   guards it. They drifted on userBoxRadius - the script and the form both said
   8, while a blanked field published 0, so clearing a field silently changed a
   rounded box to a square one. Nothing errored; the value just moved. */
{
	let m;
	const loaded = new Map(); // id -> { field, def }
	const loadOr = /\$\("([A-Za-z0-9_]+)"\)\.value = o\.([A-Za-z0-9_]+) \|\| ([0-9.]+);/g;
	while ((m = loadOr.exec(html))) loaded.set(m[1], { field: m[2], def: m[3] });
	const loadNe = /\$\("([A-Za-z0-9_]+)"\)\.value = \(?o\.([A-Za-z0-9_]+) != null \? o\.\2 : ([0-9.]+)\)?;/g;
	while ((m = loadNe.exec(html))) loaded.set(m[1], { field: m[2], def: m[3] });

	const published = new Map(); // id -> default used when the field is blank
	const saveRe = /(?:intOr|numOr)\(\$\("([A-Za-z0-9_]+)"\)\.value, ([0-9.]+)\)/g;
	while ((m = saveRe.exec(html))) published.set(m[1], m[2]);

	const drift = [];
	let compared = 0;
	for (const [id, def] of published) {
		if (!loaded.has(id)) continue;
		compared++;
		if (loaded.get(id).def !== def) drift.push(id + " loads " + loaded.get(id).def + " but publishes " + def);
	}
	ok("a blanked option publishes the same default the form loads (" + compared + " compared)",
		compared >= 6 && drift.length === 0, drift.join("; "));

	const scriptDefault = new Map();
	const luaRe = /ntOpts\.([A-Za-z0-9_]+) = math\.clamp\(tonumber\(o\.\1\) or ([0-9.]+)/g;
	while ((m = luaRe.exec(lua))) scriptDefault.set(m[1], m[2]);

	const scriptDrift = [];
	let scriptCompared = 0;
	for (const [id, info] of loaded) {
		if (!published.has(id) || !scriptDefault.has(info.field)) continue;
		scriptCompared++;
		if (scriptDefault.get(info.field) !== published.get(id)) {
			scriptDrift.push(info.field + " is " + scriptDefault.get(info.field) + " in the script, " + published.get(id) + " in the editor");
		}
	}
	ok("...and the same number the script falls back to (" + scriptCompared + " fields)",
		scriptCompared >= 5 && scriptDrift.length === 0, scriptDrift.join("; "));
}

/* ---------------------------------------------------- press-to-act commands */

/* clicktp is pressed, not configured with a window - and its key is the
   player's, like every other bind. It ships on F so it works out of the box,
   and nothing may take that decision away from them. None of these break
   loudly: the symptom is "my key stopped doing anything". */
const clickTpSpec = block(lua, 'name = "clicktp",', "\n}");
ok("clicktp can be bound to any key (it has a Keys-tab row)", /bindable = true/.test(clickTpSpec));
ok("clicktp is marked silent", /silent = true/.test(clickTpSpec));
ok("click TP ships bound to F, so it works with no setup", /^\tF = "clicktp"/m.test(lua));
// the key is a default, not a lock: an earlier cut claimed F back from every
// rebind, which made the Keys tab row a lie for this one action
ok("nothing claims the key back from the player", !/enforceClickTp/.test(lua));
// line comments stripped first: the notes above name the panel they replaced,
// and prose should not be able to satisfy or trip a check about code
const clickTpCode = lua.replace(/--[^\n]*/g, "");
ok("no Click TP panel is left anywhere in the script",
	!/openClickTp|ClickTpUI|ClickTpCleanup|ClickTpToggle/.test(clickTpCode));
ok("the command runner honours silent specs", /if spec\.silent then/.test(block(lua, "hubRunCommand = function", "\nend")));

const clickTpBody = block(lua, "local function clickTpNow()", "\nadd{");
ok("click TP teleports to what the cursor is on",
	/root\.CFrame = CFrame\.new\(hit\.Position \+ Vector3\.new\(0, 3, 0\)\)/.test(clickTpBody));
ok("click TP refuses a miss instead of teleporting off the map",
	/if not mouse or not mouse\.Target then/.test(clickTpBody));

/* A rebind has to actually move the key, and the row that shows it has to be the
   same table the key dispatch reads - three copies of "the binds" would drift. */
const keysTab = block(lua, "local bindsPage = H.makeTab(\"Keys\")", "\n\t-- stay in sync");
ok("the Keys tab lists click TP with every other bindable action",
	keysTab.length > 500 && /connect\(keyBtn\.MouseButton1Click/.test(keysTab)
		&& /H\.setBind\(action, input\.KeyCode\.Name\)/.test(keysTab), keysTab.length + " chars");

/* --------------------------------------------------- tag paint order */

/* A billboard that does not set ZIndexBehavior keeps the legacy GLOBAL one:
   paint by ZIndex, and break ties by hierarchy order. The drop shadow and a
   rule's bgImage are both a full-size layer over the pill, both at ZIndex 0, so
   whichever is later in the tree covers the other - parented last, the
   45%-opaque shadow painted a grey wash over every background image (only the
   4px it is offset by stayed at full colour). Nothing errors; only a bgImage
   tag looks wrong, which is exactly the kind of thing that ships. */
const tagBuild = block(lua, "local function ntBuild(plr, rule)", "\nlocal function ntRemove(plr)");
ok("the tag builder was found", tagBuild.length > 5000, tagBuild.length + " chars");

const shadowParent = tagBuild.indexOf("shadow.Parent = bb");
const pillParent = tagBuild.indexOf("pill.Parent = bb");
ok("the drop shadow is parented before the pill, so the pill paints over it",
	shadowParent > 0 && pillParent > 0 && shadowParent < pillParent,
	"shadow@" + shadowParent + " pill@" + pillParent);

const zOf = name => {
	const m = tagBuild.match(new RegExp(name + "\\.ZIndex = (\\d+)"));
	return m ? Number(m[1]) : null;
};
ok("the shadow is a full-size, translucent layer (so painting late would dim the tag)",
	/shadow\.Size = UDim2\.new\(1, 0, 1, 0\)/.test(tagBuild) && /shadow\.BackgroundTransparency = 0\.\d+/.test(tagBuild));
ok("the shadow sits in the lowest band", zOf("shadow") === 0, String(zOf("shadow")));
ok("the pill and its content paint above the shadow", zOf("pill") > zOf("shadow"),
	zOf("pill") + " vs " + zOf("shadow"));
ok("a bgImage stays under the pill's ring and text (its own band, above the shadow)",
	zOf("bgImg") === zOf("shadow") && zOf("bgImg") < zOf("pill"),
	"bgImg " + zOf("bgImg") + ", shadow " + zOf("shadow") + ", pill " + zOf("pill"));
// the ladder is only a ladder if the behaviour that makes ZIndex mean
// "among siblings" is pinned - otherwise the engine default decides the tag
ok("the tag pins the ZIndexBehavior its layout assumes",
	/bb\.ZIndexBehavior = Enum\.ZIndexBehavior\.Sibling/.test(tagBuild));

console.log("\n" + (failures.length ? failures.length + " FAILED (" + pass + " passed)" : pass + " checks passed"));
process.exit(failures.length ? 1 : 0);
