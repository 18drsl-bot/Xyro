// test_fb_config.js - simulate fbLoadRepoConfig's parsing paths (same logic
// as xyro.lua) against the real payloads each source returns.
const H = {
	FIREBASE_URL: "",
	FIREBASE_AUTH: "",
	HS: {
		JSONDecode: (_s, b) => JSON.parse(b),
		Base64Decode: (b) => Buffer.from(b, "base64").toString("utf8"),
	},
};

function parseBody(body) {
	// mirrors xyro.lua: JSON-DECODE the GitHub API wrapper FIRST (never regex
	// the raw payload - the API's content string has ESCAPED \n runs and 'n'
	// is a legal base64 char, so strip-then-decode corrupts the data)
	let apiMeta = null;
	if (body.includes('"content"')) {
		try {
			const parsed = JSON.parse(body);
			if (parsed && typeof parsed === "object" && typeof parsed.content === "string" && parsed.content.length > 8) {
				apiMeta = parsed;
			}
		} catch {}
	}
	if (apiMeta) {
		let decoded = null;
		try {
			decoded = Buffer.from(apiMeta.content.replace(/\s+/g, ""), "base64").toString("utf8");
		} catch {}
		if (typeof decoded === "string" && decoded !== "") body = decoded;
	}
	let okJ = true;
	let data = null;
	try {
		data = JSON.parse(body);
	} catch {
		okJ = false;
	}
	if (okJ && data && typeof data === "object") {
		const fb = data.firebase || data;
		if (fb && typeof fb === "object" && typeof fb.url === "string" && fb.url !== "") {
			// mirrors the script: the direct address never displaces an active
			// API base, it is only remembered as the fallback
			setDirect(fb.url, typeof fb.auth === "string" ? fb.auth : "");
			return "applied-json";
		}
		return "json-but-no-url";
	}
	if (!okJ && body.slice(0, 8) === "https://") {
		setDirect(body.replace(/\s+/g, ""), "");
		return "applied-bare";
	}
	return "ignored";
}

// 1. GitHub API wrapping a real firebase.json: base64 with REAL newlines,
//    JSON-stringified so they become escaped \n two-char runs on the wire -
//    the exact payload game:HttpGet returns from api.github.com
const fileBody = JSON.stringify({ firebase: { url: "https://xyro-abc123-default-rtdb.firebaseio.com", auth: "" } }, null, "\t");
const b64wrapped = Buffer.from(fileBody, "utf8").toString("base64").replace(/(.{76})/g, "$1\n");
const apiJson = JSON.stringify({ content: b64wrapped, encoding: "base64" });
// 2. raw / jsDelivr: the file itself
// 3. empty placeholder (url: "") must be ignored
// 4. bare-URL body
// 5. API 404 body (JSON, no content field)
// 6. flat form ({"url": ...} at the root)
const cases = [
	["github api + populated file", apiJson, "https://xyro-abc123-default-rtdb.firebaseio.com"],
	["raw file", fileBody, "https://xyro-abc123-default-rtdb.firebaseio.com"],
	["empty placeholder ignored", '{"firebase":{"url":""}}', ""],
	["bare url body", "https://my-db-default-rtdb.firebaseio.com", "https://my-db-default-rtdb.firebaseio.com"],
	["api 404 json body", '{"message":"Not Found","documentation_url":"..."}', ""],
	["flat form", '{"url":"https://flat-default-rtdb.firebaseio.com"}', "https://flat-default-rtdb.firebaseio.com"],
];

let fails = 0;
for (const [name, body, expected] of cases) {
	H.FIREBASE_URL = "";
	H.FIREBASE_AUTH = "";
	const got = parseBody(body);
	const ok = H.FIREBASE_URL === expected;
	if (!ok) fails++;
	console.log((ok ? "OK  " : "FAIL") + " " + name + " -> " + JSON.stringify(H.FIREBASE_URL) + " (" + got + ")");
}

// auth passthrough
H.FIREBASE_URL = "";
H.FIREBASE_AUTH = "";
parseBody('{"firebase":{"url":"https://authed-db.firebaseio.com","auth":"sekret"}}');
console.log((H.FIREBASE_AUTH === "sekret" ? "OK  " : "FAIL") + " auth passthrough -> " + JSON.stringify(H.FIREBASE_AUTH));
if (H.FIREBASE_AUTH !== "sekret") fails++;

/* ---------------------------------------------------------------- api.json
   mirrors H.fbUseApi / H.fbSetDirect / apiLoadRepoConfig in xyro.lua: the Xyro
   API base wins over the database, the database address is remembered as the
   fallback, and an explicit script-level URL still wins over both. */
H.API_URL = "";
H.API_KEY = "";
H.API_MODE = false;
H.FB_DIRECT_URL = "";
H.FB_DIRECT_AUTH = "";

function useApi(url, key) {
	url = String(url || "").trim().replace(/\/+$/, "");
	if (url === "") return false;
	H.API_URL = url;
	H.API_KEY = String(key || "");
	H.API_MODE = true;
	H.FIREBASE_URL = url;
	H.FIREBASE_AUTH = "";
	return true;
}
function setDirect(url, auth) {
	url = String(url || "").trim().replace(/\/+$/, "");
	if (url === "") return;
	H.FB_DIRECT_URL = url;
	H.FB_DIRECT_AUTH = String(auth || "");
	if (!H.API_MODE) {
		H.FIREBASE_URL = url;
		H.FIREBASE_AUTH = H.FB_DIRECT_AUTH;
	}
}
function parseApi(body) {
	body = unwrap(body);
	let okJ = true;
	let data = null;
	try { data = JSON.parse(body); } catch { okJ = false; }
	if (okJ && data && typeof data === "object") {
		const api = data.api || data;
		if (api && typeof api === "object" && typeof api.url === "string" && api.url !== "") return useApi(api.url, api.key) ? "applied-json" : "json-no-url";
		return "json-but-no-url";
	}
	if (!okJ && body.slice(0, 8) === "https://") return useApi(body, "") ? "applied-bare" : "bare-no-url";
	return "ignored";
}
function unwrap(body) {
	if (!body.includes('"content"')) return body;
	try {
		const parsed = JSON.parse(body);
		if (parsed && typeof parsed.content === "string" && parsed.content.length > 8) {
			return Buffer.from(parsed.content.replace(/\s+/g, ""), "base64").toString("utf8");
		}
	} catch {}
	return body;
}

const apiCases = [
	["api.json routes clients at the Worker", '{"api":{"url":"https://xyro-api.x.workers.dev","key":"k1"}}', true, "https://xyro-api.x.workers.dev", "k1"],
	["flat api.json", '{"url":"https://flat.x.workers.dev/","key":"k2"}', true, "https://flat.x.workers.dev", "k2"],
	["bare URL body is the Worker too", "https://bare.x.workers.dev", true, "https://bare.x.workers.dev", ""],
	["empty url keeps the direct database", '{"api":{"url":"","key":"k"}}', false, "", ""],
];
for (const [name, body, wantApi, wantBase, wantKey] of apiCases) {
	H.API_URL = ""; H.API_KEY = ""; H.API_MODE = false; H.FIREBASE_URL = ""; H.FB_DIRECT_URL = "";
	parseApi(body);
	const ok = H.API_MODE === wantApi && H.FIREBASE_URL === wantBase && H.API_KEY === wantKey;
	if (!ok) fails++;
	console.log((ok ? "OK  " : "FAIL") + " " + name + " -> api=" + H.API_MODE + " base=" + JSON.stringify(H.FIREBASE_URL) + " key=" + JSON.stringify(H.API_KEY));
}

// GitHub's contents API wrapping api.json (base64 payload inside JSON)
H.API_URL = ""; H.API_MODE = false; H.FIREBASE_URL = "";
const wrapped = JSON.stringify({ content: Buffer.from('{"api":{"url":"https://wrapped.x.workers.dev","key":"kw"}}', "utf8").toString("base64") });
parseApi(wrapped);
console.log((H.FIREBASE_URL === "https://wrapped.x.workers.dev" ? "OK  " : "FAIL") + " github-api wrapped api.json -> " + JSON.stringify(H.FIREBASE_URL));
if (H.FIREBASE_URL !== "https://wrapped.x.workers.dev") fails++;

// precedence: api.json wins, and firebase.json is still remembered as fallback
H.API_URL = ""; H.API_KEY = ""; H.API_MODE = false; H.FIREBASE_URL = ""; H.FB_DIRECT_URL = "";
parseApi('{"api":{"url":"https://xyro-api.x.workers.dev","key":"k"}}');
parseBody('{"firebase":{"url":"https://xyro-fcaf8-default-rtdb.firebaseio.com"}}');
const precOk = H.FIREBASE_URL === "https://xyro-api.x.workers.dev" && H.FB_DIRECT_URL === "https://xyro-fcaf8-default-rtdb.firebaseio.com" && H.API_MODE === true;
if (!precOk) fails++;
console.log((precOk ? "OK  " : "FAIL") + " API base wins, database kept as fallback -> " + JSON.stringify(H.FIREBASE_URL) + " / fallback " + JSON.stringify(H.FB_DIRECT_URL));

// and the demotion path (three failures in a row -> back to the database)
let apiFails = 0;
function noteResult(okFlag) {
	if (!H.API_MODE) return;
	if (okFlag) { apiFails = 0; return; }
	apiFails += 1;
	if (apiFails >= 3 && H.FB_DIRECT_URL !== "") {
		H.API_MODE = false;
		H.FIREBASE_URL = H.FB_DIRECT_URL;
		H.FIREBASE_AUTH = H.FB_DIRECT_AUTH;
	}
}
H.API_URL = ""; H.API_KEY = ""; H.API_MODE = false; H.FIREBASE_URL = ""; H.FB_DIRECT_URL = "";
parseApi('{"api":{"url":"https://xyro-api.x.workers.dev","key":"k"}}');
parseBody('{"firebase":{"url":"https://xyro-fcaf8-default-rtdb.firebaseio.com"}}');
noteResult(false); noteResult(false);
const blipOk = H.API_MODE === true; // two failures are a blip, not a demotion
noteResult(false);
const demoteOk = H.API_MODE === false && H.FIREBASE_URL === "https://xyro-fcaf8-default-rtdb.firebaseio.com";
if (!blipOk) fails++;
if (!demoteOk) fails++;
console.log((blipOk ? "OK  " : "FAIL") + " two failures keep the API");
console.log((demoteOk ? "OK  " : "FAIL") + " three failures demote to the database -> " + JSON.stringify(H.FIREBASE_URL));

// an explicit script-level URL must not be overwritten by firebase.json
H.API_MODE = false; H.FIREBASE_URL = "https://explicit.firebaseio.com"; H.FB_DIRECT_URL = "";
setDirect("https://repo.firebaseio.com", "");
const explicitOk = H.FIREBASE_URL === "https://repo.firebaseio.com";
if (!explicitOk) fails++;
console.log((explicitOk ? "OK  " : "FAIL") + " repo firebase.json still wins over nothing (in-place set) -> " + JSON.stringify(H.FIREBASE_URL));

process.exit(fails ? 1 : 0);
