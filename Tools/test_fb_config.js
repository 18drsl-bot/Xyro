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
			H.FIREBASE_URL = fb.url;
			if (typeof fb.auth === "string") H.FIREBASE_AUTH = fb.auth;
			return "applied-json";
		}
		return "json-but-no-url";
	}
	if (!okJ && body.slice(0, 8) === "https://") {
		H.FIREBASE_URL = body.replace(/\s+/g, "");
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

process.exit(fails ? 1 : 0);
