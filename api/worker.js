/**
 * Xyro API - a thin, owner-controlled front door in front of the repo and the
 * database. Deploy it on Cloudflare Workers (free tier: 100k requests/day, no
 * card). See api/README.md for the setup walkthrough.
 *
 * Why this exists
 * ---------------
 * Before this, every client talked to these hosts directly:
 *   - raw.githubusercontent.com / cdn.jsdelivr.net  -> config files
 *   - <your-db>.firebaseio.com                      -> staff list, command
 *                                                      queue, presence
 * That means the database URL (and any ?auth= secret) shipped inside a public
 * script, and the database rules had to stay open enough for anonymous clients
 * to read and write. Here the secret lives in a Cloudflare environment variable
 * that no client ever sees, so the rules can be closed to the public and only
 * this Worker keeps access.
 *
 * Two route families
 * ------------------
 * 1. DATABASE-SHAPED routes - byte-for-byte the same paths the Realtime Database
 *    REST API serves, so pointing xyro.lua at this Worker required no logic
 *    change (the script builds "<base>/cmd.json" and friends):
 *      GET    /staff.json
 *      GET    /cmd.json                      (stale entries pruned server-side)
 *      PUT    /cmd/<key>.json                (key required)
 *      DELETE /cmd/<key>.json                (key required)
 *      GET    /here.json                     (stale beats filtered out)
 *      PUT    /here/<key>.json               (key required)
 *      DELETE /here/<key>.json               (key required)
 *    Only these three nodes are proxied. The Worker is deliberately NOT a
 *    generic database proxy: anything else in the database stays unreachable.
 *
 * 2. FRIENDLY routes for the site, the Discord bot and humans:
 *      GET    /                               -> status page for humans
 *      GET    /health                        -> config self-report (JSON)
 *      GET    /version                       -> version.txt from the repo
 *      GET    /config                        -> nametags.json from the repo
 *      GET    /staff                         -> the staff object
 *      GET    /blacklist                     -> just the blacklist map
 *      POST   /blacklist/<who>               (key required) body = reason text
 *      DELETE /blacklist/<who>               (key required)
 *      GET    /online                        -> { count, online[], beats{} }
 *
 * Auth - TWO keys, deliberately
 * ----------------------------
 * Send a key as the `x-api-key` header, or `?key=` when the caller can only do
 * a plain GET (executors' game:HttpGet cannot set headers).
 *
 *   XYRO_KEY        the CLIENT key. Ships to every script user (it is in
 *                   api.json in a public repo, so treat it as public). It may
 *                   read, heartbeat, and enqueue commands - nothing else.
 *   XYRO_ADMIN_KEY  the OWNER key. Held only by you and your Discord bot. It is
 *                   required to write the blacklist and to trip the kill switch
 *                   (and that switch also needs a database credential - see the
 *                   bottom of this comment).
 *
 * The split matters: with a single key, the key inside the Lua client would also
 * authorize blacklisting a rival. Two keys mean the thing every player can
 * extract cannot do anything dangerous.
 *
 *   - reads are gated only when XYRO_KEY is set (the data is public anyway;
 *           gating it costs nothing and stops casual scraping of the DB)
 *   - admin writes FAIL CLOSED: with no XYRO_ADMIN_KEY configured they return
 *           503 rather than silently accepting anonymous writes
 *
 * A client key is not a secret - it is a speed bump. What it buys is that the
 * *database credential* never leaves this Worker, so a leaked key gets rotated
 * in one command and the rules stay shut.
 *
 * The kill switch
 * ---------------
 * `staff/gate` in the database is a remote control read by the loader and by
 * every running client:
 *
 *   { "enabled": false, "message": "down for maintenance" }
 *
 *   GET  /gate             -> the current gate (defaults to enabled)
 *   GET  /staff/gate.json  -> same thing, database-shaped, for the script
 *   POST /gate             -> admin key; body {enabled, message, warn}
 *   POST /gate/off         -> admin key; body is the message shown on screen
 *   POST /gate/on          -> admin key
 *   GET  /script           -> the script itself; 403 while the gate is off
 *
 * A gate that cannot be read fails OPEN (enabled), because a database hiccup
 * must never take the script away from everyone at once.
 *
 * Writing the gate is the one thing this Worker cannot do anonymously: the
 * database rules allow reads but refuse writes to `staff`. So POST /gate needs
 * a database credential of its own - FB_SERVICE_ACCOUNT (preferred), the split
 * FB_CLIENT_EMAIL + FB_PRIVATE_KEY, or the legacy FB_SECRET. Without one the
 * route answers 403 and says exactly that, and `npx wrangler deploy` is not the
 * fix - the credential is. See api/README.md section 5.
 */

const NODES = new Set(["staff", "cmd", "here"]);

/** A presence beat is "online" while it is newer than this (seconds). */
const PRESENCE_WINDOW = 120;
/** Queue entries older than this are deleted (matches H.fbQueuePrune in the script). */
const QUEUE_TTL = 600;
/** How far into the future a timestamp may be before it is treated as junk. */
const FUTURE_SLACK = 600;

/** Command keys look like "<unix seconds>-<random>" (built by the script). */
const CMD_KEY_RE = /^\d{1,12}-\d{1,9}$/;
/** Usernames are [A-Za-z0-9_] - keep it strict, it becomes a database path. */
const NAME_KEY_RE = /^[A-Za-z0-9_]{1,32}$/;
/** Blacklist keys may be numeric ids or usernames. */
const ANY_KEY_RE = /^[A-Za-z0-9_]{1,32}$/;

const MAX_CMD_BYTES = 512;

/** The gate, as it reads when nothing is configured (or nothing is readable). */
const GATE_DEFAULT = { enabled: true, message: "", warn: "", by: "", updated: 0, until: 0, reopens_in: 0, auto_reopened: false };

/* ---------------------------------------------------------------- plumbing */

function corsHeaders(env) {
	return {
		"access-control-allow-origin": env.ALLOW_ORIGIN || "*",
		"access-control-allow-headers": "content-type,x-api-key",
		"access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS",
		"access-control-max-age": "86400",
	};
}

function json(env, data, status = 200, extra = {}) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			...corsHeaders(env),
			...extra,
		},
	});
}

function text(env, body, status = 200, extra = {}) {
	return new Response(body, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8", ...corsHeaders(env), ...extra },
	});
}

/** Constant-time-ish compare, so a wrong key cannot be brute-forced by timing. */
function safeEqual(a, b) {
	if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function keyOf(req, url) {
	return req.headers.get("x-api-key") || url.searchParams.get("key") || "";
}

function readKeyOk(req, url, env) {
	if (!env.XYRO_KEY && !env.XYRO_ADMIN_KEY) return true; // unset = open reads (documented in /health)
	const supplied = keyOf(req, url);
	// the owner key reads too: a tool that holds only the admin key should not
	// need a second key just to see the current state
	return (env.XYRO_KEY && safeEqual(supplied, env.XYRO_KEY)) || (env.XYRO_ADMIN_KEY && safeEqual(supplied, env.XYRO_ADMIN_KEY));
}

function writeKeyResponse(req, url, env) {
	if (!env.XYRO_KEY) {
		return json(env, { error: "XYRO_KEY is not set - writes are disabled until you run: npx wrangler secret put XYRO_KEY" }, 503);
	}
	if (!safeEqual(keyOf(req, url), env.XYRO_KEY)) {
		return json(env, { error: "forbidden: bad or missing key" }, 403);
	}
	return null;
}

/** Owner-only routes: the blacklist and the kill switch. Separate from the
 *  client key on purpose - see the auth note at the top of this file. */
function adminKeyResponse(req, url, env) {
	if (!env.XYRO_ADMIN_KEY) {
		return json(env, { error: "XYRO_ADMIN_KEY is not set - admin routes are disabled until you run: npx wrangler secret put XYRO_ADMIN_KEY" }, 503);
	}
	if (!safeEqual(keyOf(req, url), env.XYRO_ADMIN_KEY)) {
		return json(env, { error: "forbidden: this route needs the admin key" }, 403);
	}
	return null;
}

/** Best-effort write throttle per isolate. Cloudflare spreads requests across
 *  many isolates, so this stops a runaway loop - not a determined attacker. */
const recentWrites = new Map();
function writeThrottled(req) {
	const bucket = (req.headers.get("cf-connecting-ip") || "local") + ":" + Math.floor(Date.now() / 60000);
	const n = (recentWrites.get(bucket) || 0) + 1;
	recentWrites.set(bucket, n);
	if (recentWrites.size > 5000) recentWrites.clear();
	return n > 120;
}

/* ---------------------------------------------------------------- database */

function fbBase(env) {
	return String(env.FB_URL || "").replace(/\/+$/, "");
}

/* ------------------------------------------ database credentials (optional)
 *
 * READS work anonymously against this database (its rules allow them), but
 * `staff` REFUSES anonymous writes - and the kill switch lives at staff/gate.
 * So an API-driven shutdown needs the Worker to hold a credential:
 *
 *   FB_SERVICE_ACCOUNT   the whole service-account key file, as JSON   (best)
 *   FB_CLIENT_EMAIL + FB_PRIVATE_KEY   the same two fields, split
 *   FB_SECRET            a legacy database secret, ?auth=             (old)
 *
 * A service account token is minted here: sign a JWT with the account's private
 * key (RS256 through WebCrypto), trade it for an OAuth access token, and send
 * that as ?access_token= so the database treats the Worker as an owner. It is
 * cached per isolate until shortly before it expires, so the exchange happens
 * about once an hour rather than once a request.
 *
 * With no credential the Worker still serves every read; only the writes that
 * the rules forbid fail - and they fail with the reason and the fix, not with
 * an opaque 502 (see fbErrorHint).
 */
const SA_SCOPE = "https://www.googleapis.com/auth/firebase.database";
const SA_TOKEN_URL = "https://oauth2.googleapis.com/token";
let saToken = { fingerprint: "", value: "", expires: 0 };
let saLastError = "";

/** The service account, from either one JSON secret or the two halves. */
function saCreds(env) {
	const blob = typeof env.FB_SERVICE_ACCOUNT === "string" ? env.FB_SERVICE_ACCOUNT.trim() : "";
	if (blob) {
		try {
			const data = JSON.parse(blob);
			if (data && data.client_email && data.private_key) {
				return { email: String(data.client_email), key: String(data.private_key) };
			}
			saLastError = "FB_SERVICE_ACCOUNT has no client_email/private_key - paste the whole key file";
		} catch {
			saLastError = "FB_SERVICE_ACCOUNT is not valid JSON - paste the whole key file, quotes and all";
		}
		return null;
	}
	if (env.FB_CLIENT_EMAIL && env.FB_PRIVATE_KEY) {
		return { email: String(env.FB_CLIENT_EMAIL), key: String(env.FB_PRIVATE_KEY) };
	}
	return null;
}

function base64url(bytes) {
	const bin = typeof bytes === "string" ? bytes : Array.from(bytes, (b) => String.fromCharCode(b)).join("");
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PEM -> DER. wrangler stores exactly what was pasted, so a literal "\\n" (the
 *  shape you get from copying JSON) has to be accepted as well as a real one. */
function pemToDer(pem) {
	const body = String(pem)
		.replace(/\\n/g, "\n")
		.replace(/-----[^-]+-----/g, "")
		.replace(/[^A-Za-z0-9+/=]/g, "");
	const bin = atob(body);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function serviceAccountToken(creds) {
	const fingerprint = creds.email + ":" + creds.key.length;
	if (saToken.value && saToken.fingerprint === fingerprint && saToken.expires - 60000 > Date.now()) {
		return saToken.value;
	}
	const now = Math.floor(Date.now() / 1000);
	const signingInput =
		base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) +
		"." +
		base64url(JSON.stringify({ iss: creds.email, scope: SA_SCOPE, aud: SA_TOKEN_URL, iat: now, exp: now + 3600 }));
	let key;
	try {
		key = await crypto.subtle.importKey("pkcs8", pemToDer(creds.key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
	} catch {
		throw new Error("the service account private key could not be read - it must be the PKCS#8 PEM from the key file");
	}
	const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
	const assertion = signingInput + "." + base64url(new Uint8Array(sig));
	const res = await fetch(SA_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + assertion,
	});
	const body = await res.text();
	if (!res.ok) throw new Error("Google refused the service account (" + res.status + "): " + body.slice(0, 200));
	let data;
	try {
		data = JSON.parse(body);
	} catch {
		throw new Error("the token exchange did not answer with JSON");
	}
	if (!data || !data.access_token) throw new Error("the token exchange returned no access_token");
	saToken = { fingerprint, value: String(data.access_token), expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
	return saToken.value;
}

/** Which credential this Worker actually holds - for /health, so "my worker has
 *  the key but the kill switch still refuses" is answerable at a glance. */
function databaseCredential(env) {
	if (env.FB_SECRET) return "legacy database secret";
	if (saCreds(env)) return "service account";
	// set but unusable: report it as a service account, with the reason alongside
	if (env.FB_SERVICE_ACCOUNT || env.FB_CLIENT_EMAIL) return "service account (unusable)";
	return "anonymous - reads only; the kill switch needs a credential (api/README.md section 5)";
}

async function fbAuthSuffix(env) {
	if (env.FB_SECRET) return "?auth=" + encodeURIComponent(env.FB_SECRET);
	const creds = saCreds(env);
	if (!creds) return "";
	try {
		const token = await serviceAccountToken(creds);
		saLastError = "";
		return "?access_token=" + encodeURIComponent(token);
	} catch (err) {
		// fail soft: every read still works anonymously, and a write that the
		// rules then refuse reports this reason instead of hiding it
		saLastError = err && err.message ? err.message : String(err);
		return "";
	}
}

/** How a database refusal should read to the caller: a refused rule is the
 *  caller's problem (403), anything else is the Worker's (502). */
function fbErrorStatus(reason) {
	return /permission denied|unauthoriz|invalid.?token|expired|invalid.?credential/i.test(reason) ? 403 : 502;
}

function fbErrorHint(env, reason) {
	if (!/permission denied/i.test(reason)) return "";
	const held = env.FB_SECRET ? "the database secret" : saCreds(env) ? "the service account" : "";
	if (held) {
		// saCreds above may have just set this, so it is read afterwards on purpose
		return " - and " + held + " this Worker holds was refused too: " + (saLastError || "check that it belongs to this database");
	}
	return " - this database refuses anonymous writes to it. Set FB_SERVICE_ACCOUNT (api/README.md section 5) to give the Worker an owner credential, or trip the kill switch in the Firebase console instead.";
}

class ApiError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/** Pull Firebase's reason out of a body like {"error":"Permission denied"}. */
function fbErrorText(body) {
	if (typeof body !== "string" || body === "" || body === "null") return null;
	try {
		const data = JSON.parse(body);
		if (data && typeof data === "object" && data.error) return String(data.error);
	} catch {
		/* not JSON - no reason to report */
	}
	return null;
}

/**
 * One database request. Returns the raw body string (Firebase serves "null" for
 * an empty node). Throws ApiError on failure - and never turns a refusal into a
 * 200, which is the trap the raw REST API sets: it answers a denied read with
 * HTTP 200 and {"error":"Permission denied"} in the body, so a client that only
 * checks the status code reports "healthy queue" while dropping every command.
 */
async function fb(env, path, init) {
	const base = fbBase(env);
	if (!base) throw new ApiError(500, "FB_URL is not configured on this Worker");
	let res;
	try {
		res = await fetch(base + "/" + path + ".json" + (await fbAuthSuffix(env)), init);
	} catch (err) {
		throw new ApiError(502, "database unreachable: " + (err && err.message ? err.message : String(err)));
	}
	const body = await res.text();
	const reason = fbErrorText(body) || (res.ok ? null : "database responded " + res.status);
	if (reason) throw new ApiError(fbErrorStatus(reason), reason + fbErrorHint(env, reason));
	return body;
}

function parseNode(body) {
	if (typeof body !== "string" || body === "" || body === "null") return {};
	try {
		const data = JSON.parse(body);
		return data && typeof data === "object" ? data : {};
	} catch {
		return {};
	}
}

/** Drop queue entries and presence beats that have aged out, in the background
 *  so the reader is not made to wait. The nodes therefore cannot grow forever
 *  even if every client is killed mid-session. */
function pruneInBackground(env, ctx, node, data) {
	if (!ctx || typeof ctx.waitUntil !== "function") return;
	const now = Math.floor(Date.now() / 1000);
	const stale = [];
	if (node === "cmd") {
		for (const key of Object.keys(data)) {
			const sec = Number(String(key).match(/^(\d+)-/)?.[1]);
			if (!sec) {
				stale.push(key);
			} else if (now - sec > QUEUE_TTL || sec - now > FUTURE_SLACK) {
				stale.push(key);
			}
		}
	} else {
		for (const [key, value] of Object.entries(data)) {
			const sec = Number(value);
			if (!sec || now - sec > QUEUE_TTL) stale.push(key);
		}
	}
	if (!stale.length) return;
	ctx.waitUntil(
		Promise.all(
			stale.map((key) =>
				fb(env, node + "/" + key, { method: "DELETE" }).catch(() => {})
			)
		)
	);
}

function freshOnly(node, data, window) {
	const now = Math.floor(Date.now() / 1000);
	const out = {};
	for (const [key, value] of Object.entries(data)) {
		if (node === "cmd") {
			const sec = Number(String(key).match(/^(\d+)-/)?.[1]);
			if (sec && now - sec <= 90 && sec <= now + 120) out[key] = value;
		} else {
			const sec = Number(value);
			if (sec && now - sec <= window) out[key] = sec;
		}
	}
	return out;
}

/* ------------------------------------------------------------------- gate */

/** Accepts {enabled, message, warn, until, by, updated}, or a bare boolean for
 *  the people who just type `false` into the Firebase console.
 *
 *  `until` is an absolute unix timestamp: the switch closes ITSELF when it
 *  passes, so a forgotten maintenance window cannot lock everybody out for a
 *  day. An expired gate reads as enabled and stops showing its stale message. */
function normalizeGate(raw) {
	if (raw === false) return { ...GATE_DEFAULT, enabled: false };
	if (raw === true) return { ...GATE_DEFAULT };
	const g = raw && typeof raw === "object" ? raw : {};
	const now = Math.floor(Date.now() / 1000);
	const until = Math.max(0, Math.floor(Number(g.until) || 0));
	const expired = until > 0 && now >= until;
	const off = g.enabled === false && !expired;
	return {
		enabled: !off, // anything unclear = live
		message: off && typeof g.message === "string" ? g.message.slice(0, 300) : "",
		warn: typeof g.warn === "string" ? g.warn.slice(0, 200) : "",
		by: typeof g.by === "string" ? g.by.slice(0, 60) : "",
		updated: Number(g.updated) || 0,
		until: expired ? 0 : until,
		reopens_in: off && until > 0 ? until - now : 0,
		auto_reopened: expired && g.enabled === false,
	};
}

/**
 * Read the kill switch. Never throws: a database that is down, denied or simply
 * has no gate node answers "enabled", so a broken database can never lock every
 * player out of the script. `source` says which of the three happened.
 */
async function readGate(env) {
	try {
		const body = await fb(env, "staff/gate");
		if (body === "null" || body === "") return { ...GATE_DEFAULT, source: "default" };
		let parsed;
		try {
			parsed = JSON.parse(body);
		} catch {
			return { ...GATE_DEFAULT, source: "unreadable" };
		}
		return { ...normalizeGate(parsed), source: "database" };
	} catch {
		return { ...GATE_DEFAULT, source: "unreachable" };
	}
}

/* ----------------------------------------------------------- status page */

/** Everything interpolated into the page goes through this: the gate message is
 *  written by whoever holds the admin key, and an unescaped admin input is
 *  still an injection. */
function esc(s) {
	return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function ago(sec) {
	const s = Math.max(0, Math.floor(Date.now() / 1000) - Number(sec || 0));
	if (!s) return "just now";
	if (s < 60) return s + "s ago";
	if (s < 3600) return Math.floor(s / 60) + "m ago";
	if (s < 86400) return Math.floor(s / 3600) + "h ago";
	return Math.floor(s / 86400) + "d ago";
}

function inFuture(sec) {
	const s = Math.max(0, Number(sec || 0));
	if (s < 60) return "in " + s + "s";
	if (s < 3600) return "in " + Math.floor(s / 60) + "m";
	if (s < 86400) return "in " + Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
	return "in " + Math.floor(s / 86400) + "d";
}

/**
 * A page for humans. `/health` stays JSON for machines; this is what you send
 * someone who asks "is it down?". It never throws: an unreachable database is
 * shown as DEGRADED, which is exactly the state worth seeing.
 */
async function statusPage(env) {
	const gate = await readGate(env);
	let dbOk = true;
	let dbError = "";
	let online = 0;
	try {
		const data = parseNode(await fb(env, "here"));
		online = Object.keys(freshOnly("here", data, PRESENCE_WINDOW)).length;
	} catch (err) {
		dbOk = false;
		dbError = err && err.message ? err.message : String(err);
	}
	let version = "";
	try {
		version = (await repoFile(env, "version.txt", false)).trim().slice(0, 24);
	} catch {
		version = "";
	}

	const state = !gate.enabled
		? { label: "DISABLED", color: "#e2aa3c", note: "The script is switched off for everyone." + (gate.reopens_in > 0 ? " It re-opens by itself " + inFuture(gate.reopens_in) + "." : "") }
		: dbOk
			? { label: "LIVE", color: "#34d399", note: "The script is up and talking to the database." }
			: { label: "DEGRADED", color: "#e85050", note: "The API cannot reach the database. Clients keep running on what they already have." };

	const row = (k, v) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${v}</span></div>`;
	const dot = ok => `<span class="dot" style="background:${ok ? "#34d399" : "#e85050"}"></span>`;

	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>Xyro status - ${esc(state.label)}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0e;color:#e8e8ec;
font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:min(520px,92vw);background:#14141a;border:1px solid #26262e;border-radius:14px;padding:22px 24px}
h1{margin:0 0 4px;font-size:15px;font-weight:600;letter-spacing:.02em;color:#9a9aa6}
.state{display:flex;align-items:center;gap:10px;font-size:26px;font-weight:700;letter-spacing:.01em}
.big{width:12px;height:12px;border-radius:50%}
.note{margin:8px 0 18px;color:#8a8a96;font-size:14px}
.msg{margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#191713;border:1px solid #3a3020;color:#e6d5ae}
.msg b{display:block;color:#e2aa3c;font-weight:600;margin-bottom:4px}
.row{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-top:1px solid #22222a;font-size:14px}
.k{color:#8a8a96}
.v{color:#dcdce4;text-align:right;font-variant-numeric:tabular-nums}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px}
footer{margin-top:18px;padding-top:14px;border-top:1px solid #22222a;color:#6e6e7a;font-size:12.5px}
code{background:#1c1c22;padding:1px 5px;border-radius:5px;color:#b9b9c6;font-size:12.5px}
a{color:#7f93ff;text-decoration:none}
a:hover{text-decoration:underline}
</style></head><body><div class="card">
<h1>XYRO API</h1>
<div class="state"><span class="big" style="background:${state.color}"></span>${esc(state.label)}</div>
<p class="note">${esc(state.note)}</p>
${gate.message ? `<div class="msg"><b>Message</b>${esc(gate.message)}</div>` : ""}
${gate.warn ? `<div class="msg"><b>Heads up</b>${esc(gate.warn)}</div>` : ""}
${row("Gate", `${dot(gate.enabled)}${gate.enabled ? "open" : "switched off"} <span style=\"color:#6e6e7a\">(${esc(gate.source)})</span>`)}
${gate.updated ? row("Set", `${esc(ago(gate.updated))}${gate.by ? " by " + esc(gate.by) : ""}`) : ""}
${gate.reopens_in > 0 ? row("Re-opens", esc(inFuture(gate.reopens_in))) : ""}
${gate.auto_reopened ? row("Note", "the gate closed itself - the window you set has passed") : ""}
${row("Database", `${dot(dbOk)}${dbOk ? "connected" : esc(dbError || "unreachable")}`)}
${row("Players running now", String(online))}
${version ? row("Script version", esc(version)) : ""}
${row("Reads", env.XYRO_KEY ? "key required" : "open")}
<footer>
Machine-readable: <a href="/health">/health</a> \u00b7 script source: <code>/script</code> \u00b7 this page refreshes every 30s
</footer>
</div></body></html>`;

	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...corsHeaders(env) },
	});
}

/* ------------------------------------------------------------- repo files */

async function repoFile(env, name, bust) {
	const raw = (env.RAW_REPO || "https://raw.githubusercontent.com/vertxxy-1/Xyro/main").replace(/\/+$/, "");
	const res = await fetch(raw + "/" + name + (bust ? "?t=" + Date.now() : ""), {
		cf: { cacheTtl: 30, cacheEverything: true },
	});
	if (!res.ok) throw new ApiError(502, "repo file " + name + " returned " + res.status);
	return await res.text();
}

/** Edge-cached GET. Cloudflare's cache is keyed on the URL, and `?fresh=1`
 *  bypasses it entirely (raw GitHub alone edge-caches for minutes). */
async function cached(env, ctx, url, ttl, contentType, produce) {
	const fresh = url.searchParams.has("fresh");
	const canCache = typeof caches !== "undefined" && caches.default && !fresh;
	const cacheKey = new Request(url.origin + url.pathname);
	if (canCache) {
		const hit = await caches.default.match(cacheKey);
		if (hit) return hit;
	}
	const body = await produce();
	const res = new Response(body, {
		headers: {
			"content-type": contentType,
			...corsHeaders(env),
			"cache-control": fresh ? "no-store" : "public, max-age=" + ttl,
		},
	});
	if (canCache && ttl > 0) {
		// Storing the response itself (not a clone) is fine - the caller gets the
		// same bytes, and the copy in the cache is keyed by path alone, so the
		// key never leaks into a shared cache entry.
		ctx.waitUntil(caches.default.put(cacheKey, new Response(body, res)));
	}
	return res;
}

/* ----------------------------------------------------------------- routes */

async function health(env, url) {
	const gate = await readGate(env);
	return json(env, {
		ok: true,
		service: "xyro-api",
		time: new Date().toISOString(),
		database: fbBase(env) ? "configured" : "missing (set the FB_URL var)",
		database_secret: env.FB_SECRET ? "set" : "not set (fine while rules allow anonymous reads)",
		database_auth: databaseCredential(env),
		database_auth_error: saLastError || undefined,
		reads: env.XYRO_KEY ? "key required" : "open",
		writes: env.XYRO_KEY ? "key required" : "DISABLED (no XYRO_KEY)",
		admin_writes: env.XYRO_ADMIN_KEY ? "admin key required" : "DISABLED (no XYRO_ADMIN_KEY)",
		gate: { enabled: gate.enabled, message: gate.message, source: gate.source },
		nodes: [...NODES],
		presence_window: PRESENCE_WINDOW,
		queue_ttl: QUEUE_TTL,
	});
}

/** Serve the script, refusing anything that looks truncated on the way through -
 *  every client then gets the same guard the loader applies locally. */
async function serveScript(env, url) {
	const raw = (env.RAW_REPO || "https://raw.githubusercontent.com/vertxxy-1/Xyro/main").replace(/\/+$/, "");
	let res;
	try {
		res = await fetch(raw + "/xyro.lua" + (url.searchParams.has("fresh") ? "?t=" + Date.now() : ""), {
			cf: { cacheTtl: 0 }, // never hand out an edge-cached older revision
		});
	} catch (err) {
		throw new ApiError(502, "repo unreachable: " + (err && err.message ? err.message : String(err)));
	}
	if (!res.ok) throw new ApiError(502, "repo script returned " + res.status);
	const src = await res.text();
	if (src.length < 100000 || !src.includes("H.Nametags") || !src.includes("RenderStepped")) {
		throw new ApiError(502, "repo script looks wrong or truncated (" + src.length + " bytes)");
	}
	return new Response(src, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			...corsHeaders(env),
			"cache-control": "no-store",
			"x-xyro-bytes": String(src.length),
		},
	});
}

/** GET /online -> the current presence list, old beats already filtered out. */
async function online(env, url) {
	const window = Math.min(Math.max(Number(url.searchParams.get("window")) || PRESENCE_WINDOW, 5), 600);
	const data = parseNode(await fb(env, "here"));
	const fresh = freshOnly("here", data, window);
	const names = Object.keys(fresh).sort((a, b) => b - a);
	return json(env, { count: names.length, online: names, beats: fresh, window });
}

async function blacklistMap(env) {
	const staff = parseNode(await fb(env, "staff"));
	const list = staff.blacklist;
	return list && typeof list === "object" ? list : {};
}

async function setBlacklist(env, who, reason, remove) {
	await fb(env, "staff/blacklist/" + who, remove
		? { method: "DELETE" }
		: { method: "PUT", body: JSON.stringify(String(reason == null ? "" : reason)) });
	return json(env, { ok: true, who, action: remove ? "removed" : "blocked" });
}

async function handle(req, env, ctx) {
	const url = new URL(req.url);
	let path = url.pathname.replace(/\/{2,}/g, "/");
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });

	/* --- open metadata (no key: this is how you check a deploy) ------------ */
	/* a page for humans at / and /status, JSON at /health for everything else */
	if (path === "/" || path === "/status") return statusPage(env);
	if (path === "/health") return health(env, url);

	if (path === "/version") {
		return cached(env, ctx, url, 60, "text/plain; charset=utf-8", () => repoFile(env, "version.txt", url.searchParams.has("fresh")));
	}
	if (path === "/config") {
		return cached(env, ctx, url, 60, "application/json; charset=utf-8", () => repoFile(env, "nametags.json", url.searchParams.has("fresh")));
	}
	/* the script itself, served from here when a client prefers it: this is what
	   makes the kill switch able to cut a loader off at the source */
	if (path === "/script" && req.method === "GET") {
		if (!readKeyOk(req, url, env)) return json(env, { error: "forbidden: bad or missing key" }, 403);
		const gate = await readGate(env);
		if (!gate.enabled) {
			return text(env, "Xyro is disabled" + (gate.message ? ": " + gate.message : "") + "\n", 403);
		}
		return serveScript(env, url);
	}

	/* --- database-shaped routes (what xyro.lua speaks) --------------------- */
	const nodeFile = path.match(/^\/(staff|cmd|here)\.json$/);
	if (nodeFile && req.method === "GET") {
		if (!readKeyOk(req, url, env)) return json(env, { error: "forbidden: bad or missing key" }, 403);
		const node = nodeFile[1];
		const data = parseNode(await fb(env, node));
		if (node === "staff") return json(env, data, 200, { "cache-control": url.searchParams.has("fresh") ? "no-store" : "public, max-age=10" });
		pruneInBackground(env, ctx, node, data);
		return json(env, freshOnly(node, data, PRESENCE_WINDOW), 200, { "cache-control": "no-store" });
	}

	const nodeKey = path.match(/^\/(cmd|here)\/([^/]+)\.json$/);
	if (nodeKey && (req.method === "PUT" || req.method === "DELETE")) {
		const denied = writeKeyResponse(req, url, env);
		if (denied) return denied;
		if (writeThrottled(req)) return json(env, { error: "too many writes, slow down" }, 429);
		const node = nodeKey[1];
		const key = decodeURIComponent(nodeKey[2]);
		const valid = node === "cmd" ? CMD_KEY_RE.test(key) : NAME_KEY_RE.test(key);
		if (!valid) return json(env, { error: "bad key format for /" + node }, 400);

		if (req.method === "DELETE") {
			await fb(env, node + "/" + key, { method: "DELETE" });
			return json(env, { ok: true });
		}

		const raw = await req.text();
		if (raw.length > MAX_CMD_BYTES) return json(env, { error: "body too large" }, 413);
		let stored;
		if (node === "here") {
			// presence: a plain unix-seconds value, stored as a number
			const sec = Number(raw.replace(/^"|"$/g, ""));
			if (!Number.isFinite(sec) || sec <= 0) return json(env, { error: "presence value must be unix seconds" }, 400);
			stored = String(Math.floor(sec));
		} else {
			// commands: a JSON string. Accept both a JSON-encoded string (what the
			// script sends) and a bare one, so curl testing is painless.
			let value = raw;
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed === "string") value = parsed;
			} catch {
				/* keep the raw text */
			}
			if (!value || value.length > MAX_CMD_BYTES) return json(env, { error: "empty or oversized command" }, 400);
			if (!/^[0-9]{1,12}\|[A-Za-z0-9_]{1,32}\|/.test(value)) {
				return json(env, { error: 'command must look like "<userId>|<name>|<cmd>[:<targets>]"' }, 400);
			}
			stored = JSON.stringify(value);
		}
		await fb(env, node + "/" + key, { method: "PUT", body: stored });
		return json(env, { ok: true });
	}

	/* --- the kill switch ---------------------------------------------------- */
	if ((path === "/gate" || path === "/staff/gate.json") && req.method === "GET") {
		if (!readKeyOk(req, url, env)) return json(env, { error: "forbidden: bad or missing key" }, 403);
		return json(env, await readGate(env), 200, { "cache-control": "no-store" });
	}
	if ((path === "/gate" || path === "/gate/off" || path === "/gate/on") && req.method === "POST") {
		const denied = adminKeyResponse(req, url, env);
		if (denied) return denied;
		if (writeThrottled(req)) return json(env, { error: "too many writes, slow down" }, 429);
		const patch = {};
		const forSeconds = Math.max(0, Math.floor(Number(url.searchParams.get("for")) || 0));
		if (path === "/gate/off" || path === "/gate/on") {
			patch.enabled = path === "/gate/on";
			patch.message = (await req.text()).slice(0, 300);
			if (forSeconds > 0) patch.until = Math.floor(Date.now() / 1000) + forSeconds;
		} else {
			const raw = await req.text();
			let body;
			try {
				body = raw ? JSON.parse(raw) : {};
			} catch {
				body = { message: raw }; // a bare body is read as the message
			}
			if (!body || typeof body !== "object") body = {};
			if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
			if (typeof body.message === "string") patch.message = body.message.slice(0, 300);
			if (typeof body.warn === "string") patch.warn = body.warn.slice(0, 200);
			if (Number.isFinite(Number(body.until))) patch.until = Math.max(0, Math.floor(Number(body.until)));
			if (!patch.until && Number.isFinite(Number(body.for)) && Number(body.for) > 0) {
				patch.until = Math.floor(Date.now() / 1000) + Math.floor(Number(body.for));
			}
		}
		if (patch.enabled === undefined && patch.message === undefined && patch.warn === undefined && patch.until === undefined) {
			return json(env, { error: "send {enabled, message, warn} as JSON, or use /gate/off and /gate/on" }, 400);
		}
		// merge over the current gate so a partial patch keeps the other fields
		const current = await readGate(env);
		const merged = { ...current, ...patch, by: String(req.headers.get("x-xyro-by") || "api").slice(0, 60), updated: Math.floor(Date.now() / 1000) };
		if (patch.enabled === true && patch.message === undefined) merged.message = "";
		if (patch.enabled === true && patch.until === undefined) merged.until = 0;
		// store ONLY what a reader needs. `reopens_in`, `auto_reopened` and
		// `source` are derived - writing them back would slowly rot the node, and
		// returning them straight from the merge would report a re-open window
		// as "0 seconds" on the very request that set it.
		const stored = {
			enabled: merged.enabled !== false,
			message: typeof merged.message === "string" ? merged.message.slice(0, 300) : "",
			warn: typeof merged.warn === "string" ? merged.warn.slice(0, 200) : "",
			until: Math.max(0, Math.floor(Number(merged.until) || 0)),
			by: merged.by,
			updated: merged.updated,
		};
		await fb(env, "staff/gate", { method: "PUT", body: JSON.stringify(stored) });
		return json(env, { ok: true, gate: { ...normalizeGate(stored), source: "database" } });
	}

	/* --- friendly routes --------------------------------------------------- */
	if (path === "/online" && req.method === "GET") {
		if (!readKeyOk(req, url, env)) return json(env, { error: "forbidden: bad or missing key" }, 403);
		return online(env, url);
	}
	if (path === "/staff" && req.method === "GET") {
		if (!readKeyOk(req, url, env)) return json(env, { error: "forbidden: bad or missing key" }, 403);
		return json(env, parseNode(await fb(env, "staff")));
	}
	if (path === "/blacklist" && req.method === "GET") {
		if (!readKeyOk(req, url, env)) return json(env, { error: "forbidden: bad or missing key" }, 403);
		const list = await blacklistMap(env);
		return json(env, { count: Object.keys(list).length, blacklist: list });
	}
	const bl = path.match(/^\/blacklist\/([^/]+)$/);
	if (bl && (req.method === "POST" || req.method === "DELETE")) {
		// the OWNER key, not the client key: a client key is public, and gating
		// the blacklist behind it would let any player block a rival
		const denied = adminKeyResponse(req, url, env);
		if (denied) return denied;
		if (writeThrottled(req)) return json(env, { error: "too many writes, slow down" }, 429);
		const who = decodeURIComponent(bl[1]);
		if (!ANY_KEY_RE.test(who)) return json(env, { error: "bad key format" }, 400);
		const reason = req.method === "POST" ? await req.text() : "";
		return setBlacklist(env, who, reason.slice(0, 200), req.method === "DELETE");
	}

	return json(env, { error: "not found", path }, 404);
}

export default {
	async fetch(req, env, ctx) {
		try {
			return await handle(req, env, ctx || {});
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 500;
			return json(env, { error: err && err.message ? err.message : String(err) }, status);
		}
	},
};
