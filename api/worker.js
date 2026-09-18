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
 * 2. NAMETAG routes - the tag system hosted here instead of on GitHub's CDN:
 *      GET    /nametags                      -> the published tag rules
 *      GET    /nametags.json, /config        -> aliases for the same bytes
 *      GET    /media/<file>                  -> seals, verified badge, artwork
 *      PUT    /nametags                      (owner key + GH_TOKEN) publish them
 *      POST   /nametags/check                (owner key) can this Worker publish?
 *    The rules are public and ungated on purpose (the editor has no key, and
 *    the file is public in the repo anyway); publishing is owner-only, and a
 *    stale editor can send ?sha= so GitHub rejects it rather than clobbering a
 *    newer revision.
 *
 * 3. FRIENDLY routes for the site, the Discord bot and humans:
 *      GET    /                               -> status page for humans
 *      GET    /health                        -> config self-report (JSON)
 *      GET    /version                       -> version.txt from the repo
 *      GET    /staff                         -> the staff object
 *      GET    /blacklist                     -> just the blacklist map
 *      POST   /blacklist/<who>               (key required) body = reason text
 *      DELETE /blacklist/<who>               (key required) *   GET    /online                        -> { count, online[], beats{} }
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
 *   GET  /loader           -> the loader you hand out; 403 while the gate is off
 *
 * A gate that cannot be read fails OPEN (enabled), because a database hiccup
 * must never take the script away from everyone at once.
 *
 * Writing the gate is the one thing this Worker cannot do anonymously: the
 * database rules allow reads but refuse writes to `staff`. So POST /gate needs
 * a database credential of its own - FB_SERVICE_ACCOUNT (preferred), the split
 * FB_CLIENT_EMAIL + FB_PRIVATE_KEY, or the legacy FB_SECRET. Without one the
 * route answers 403 and says exactly that, and `npx wrangler deploy` is not the
 * fix - the credential is. See api/README.md section 4.
 */

const NODES = new Set(["staff", "cmd", "here"]);
/** The tag rule file behind GET /nametags, and what PUT /nametags commits. */
const NAMETAGS_FILE = "nametags.json";

/** A presence beat is "online" while it is newer than this (seconds).
 *
 *  This MUST equal the clients' own window, or the three disagree: the game
 *  draws a player's tag until NT_BEAT_WINDOW (xyro.lua), the editor lists them
 *  until its PRESENCE_WINDOW (index.html), and this Worker reports them running
 *  until PRESENCE_WINDOW here. It used to be 120 against the clients' 75, so the
 *  status page and /online kept calling someone "running now" for 45 seconds
 *  after the game had already taken their tag away - which reads as the site
 *  showing a ghost. Tools/test_contract.js asserts all three stay equal. */
const PRESENCE_WINDOW = 75;
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
		// a browser can only READ a custom header if it is exposed. The editor
		// needs x-xyro-sha to publish safely (it goes back as ?sha= so GitHub
		// refuses a stale write instead of overwriting a newer revision).
		"access-control-expose-headers": "x-xyro-sha,x-xyro-source,x-xyro-bytes",
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
	return "anonymous - reads only; the kill switch needs a credential (api/README.md section 4)";
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
	return " - this database refuses anonymous writes to it. Set FB_SERVICE_ACCOUNT (api/README.md section 4) to give the Worker an owner credential, or trip the kill switch in the Firebase console instead.";
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
${row("Nametags", `served here \u00b7 <a href="/nametags">/nametags</a> + <code>/media/*</code>`)}
${row("Publishing tags", env.GH_TOKEN ? `${dot(true)}through this API ${env.XYRO_PUBLISH_KEY ? "(publish-only key set)" : "(owner key)"}` : `${dot(false)}unavailable - set GH_TOKEN`)}
<footer>
Machine-readable: <a href="/health">/health</a> \u00b7 script: <code>/script</code> \u00b7 loader to hand out: <code>/loader</code> \u00b7 tag rules: <a href="/nametags">/nametags</a> \u00b7 <a href="/editor">tag editor</a> \u00b7 this page refreshes every 30s
</footer>
</div></body></html>`;

	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...corsHeaders(env) },
	});
}

/* ------------------------------------------------------------- repo files */

const DEFAULT_RAW_REPO = "https://raw.githubusercontent.com/vertxxy-1/Xyro/main";

async function repoFile(env, name, bust) {
	const raw = (env.RAW_REPO || DEFAULT_RAW_REPO).replace(/\/+$/, "");
	const res = await fetch(raw + "/" + name + (bust ? "?t=" + Date.now() : ""), {
		cf: { cacheTtl: 30, cacheEverything: true },
	});
	if (!res.ok) throw new ApiError(502, "repo file " + name + " returned " + res.status);
	return await res.text();
}

/* --------------------------------------------- repo content (the nametags) */

/** The repo this Worker reads from, as owner/repo/branch. Derived from RAW_REPO
 *  so a fork only has to set that one var. */
function repoRef(env) {
	const raw = (env.RAW_REPO || DEFAULT_RAW_REPO).replace(/\/+$/, "");
	const m = raw.match(/^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)$/);
	return m ? { owner: m[1], repo: m[2], branch: m[3] } : { owner: "vertxxy-1", repo: "Xyro", branch: "main" };
}

/** Bytes of one repo file, from the freshest source available.
 *
 *  GH_TOKEN (optional) switches reads to the GitHub contents API: it is never
 *  CDN-cached, and its rate limit is per ACCOUNT rather than per IP - which
 *  matters here, because every client of this Worker shares Cloudflare's egress
 *  addresses and the anonymous 60/hour bucket is useless at that scale.
 *
 *  Without it we read raw.githubusercontent with a unique cache-buster on every
 *  fetch - not only on `?fresh=1`. That matters: a plain `<raw>/nametags.json`
 *  is cached by GitHub's own edge for minutes, so a Worker cache miss could
 *  still pick up the revision before the one you just published, and then cache
 *  THAT for another 30 seconds. jsDelivr is deliberately never used: its edge
 *  has served days-stale copies even after a "successful" purge, which is how
 *  the game and the editor ended up disagreeing about the rules.
 *
 *  Returns { bytes, sha, source } - `sha` is only known on the API path. */
async function repoBytes(env, name, bust) {
	const ref = repoRef(env);
	let shaFromApi = "";
	if (env.GH_TOKEN) {
		try {
			const api = "https://api.github.com/repos/" + ref.owner + "/" + ref.repo + "/contents/" + name +
				"?ref=" + ref.branch + (bust ? "&t=" + Date.now() : "");
			const res = await fetch(api, {
				headers: {
					authorization: "Bearer " + env.GH_TOKEN,
					accept: "application/vnd.github+json",
					"user-agent": "xyro-api",
				},
			});
			if (res.ok) {
				const envelope = await res.json();
				/* The contents API only INLINES content for files up to 1 MB. Bigger
				   ones come back as content:"" plus encoding:"none" - and decoding
				   that yields an empty body, which is served as a blank image. Not
				   theoretical: the 2 MB tag artwork did exactly this the moment a repo
				   token was configured, while every small seal kept working. Raw has
				   no such limit, so anything the API will not inline is read from raw
				   instead (the sha is still worth keeping - a publish sends it back). */
				if (envelope && envelope.sha) shaFromApi = envelope.sha;
				// (not gated on encoding ==="base64": a response that simply omits the
				// field is still fine, "none" is the one that means "no content here")
				if (envelope && typeof envelope.content === "string" && envelope.content !== "" && envelope.encoding !== "none") {
					const bin = atob(envelope.content.replace(/\s/g, ""));
					const bytes = new Uint8Array(bin.length);
					for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
					return { bytes, sha: shaFromApi, source: "github-api" };
				}
			} else if (res.status === 404) {
				throw new ApiError(404, "no such repo file: " + name);
			}
		} catch (err) {
			if (err instanceof ApiError) throw err;
			/* otherwise fall through to raw - a token hiccup must not take the
			   nametags offline */
		}
	}
	// always bust: an uncached URL is what makes GitHub's edge hand back the
	// current file rather than its own few-minute-old copy
	const raw = (env.RAW_REPO || DEFAULT_RAW_REPO).replace(/\/+$/, "") + "/" + name + "?t=" + Date.now();
	const res = await fetch(raw, { cf: { cacheTtl: 0 } });
	if (res.status === 404) throw new ApiError(404, "no such repo file: " + name);
	if (!res.ok) throw new ApiError(502, "repo file " + name + " returned " + res.status);
	const bytes = new Uint8Array(await res.arrayBuffer());
	/* Refuse an empty body rather than passing it on. A 200 with nothing in it
	   is how the 1 MB trap above reached clients as a blank badge: silence is
	   the one failure mode nobody can debug from inside the game. */
	if (bytes.length === 0) {
		throw new ApiError(502, "repo file " + name + " came back empty (0 bytes) - refusing to serve it");
	}
	return { bytes, sha: shaFromApi, source: shaFromApi ? "raw (too big for the contents API to inline)" : "raw" };
}

/** GET /nametags (aliases /nametags.json and /config) - the published tag
 *  rules, from one origin, with no token, no GitHub rate limit and no CDN
 *  between the file and the client.
 *
 *  Deliberately NOT key-gated, for the same reason /loader is not: the rules
 *  are public in the repo anyway, the tag editor is a public page, and the one
 *  thing a key here would break is the editor's ability to show you what is
 *  actually published. The gate does not cut this off either - everyone should
 *  be able to read the rules the maintenance message is written in.
 *
 *  Edge-cached briefly (30s) so a polling client costs almost nothing, with
 *  `?fresh=1` for the two callers who must not see a cache: opening the editor
 *  and the script's manual refresh. */
/* ------------------------------------------------------------------- rules
 *
 * Where the published tag rules live, in order: this Worker's own database
 * (D1), then the repo file.
 *
 * The database is what makes publishing possible WITHOUT a repo token. A git
 * blob sha and a token exist because the rules used to be a file in a git
 * repo; once the rules are a row in a database this Worker owns, the only
 * credential a publish needs is the owner key the editor already has. The
 * table starts empty, and an empty table means "use the repo file", so this is
 * a seed-and-fallback rather than a migration: the repo copy keeps working as
 * the origin of the rules until the first publish through the API.
 */

/** Validate a rules document before it is served OR stored. A half-valid
 *  document is the one failure that reaches every player, so it is refused at
 *  both ends rather than stored and served later. */
function parseRules(text, where) {
	let parsed = null;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = null;
	}
	if (!parsed || !Array.isArray(parsed.tags) || !parsed.options || typeof parsed.options !== "object") {
		throw new ApiError(502, where + " is not {options, tags[]} (served " + text.length + " bytes)");
	}
	return parsed;
}

/** The rules from the database, or null when there are none yet. `rev` is the
 *  concurrency guard: it is handed out as x-xyro-sha and sent back on a
 *  publish, exactly like the git blob sha used to be. */
/** The largest rules document a publish may send. See publishNametags: this is
 *  the store's ceiling, not a preference, and exceeding it is reported with the
 *  cause rather than an opaque failure. */
const MAX_RULES_BYTES = 4 * 1024 * 1024;

async function storedRules(env) {
	if (!env.xyro_tags || typeof env.xyro_tags.prepare !== "function") return null;
	const row = await env.xyro_tags.prepare("SELECT body, rev FROM rules WHERE id = 1").first();
	if (!row || typeof row.body !== "string" || row.body === "") return null;
	return { body: row.body, rev: Number(row.rev) || 1 };
}

/** Store the rules, but only if the row has not moved since the caller read
 *  it. One statement, so it either lands or it does not - a stale tab cannot
 *  overwrite a newer revision, which is the whole reason this is a single
 *  compare-and-set instead of a read followed by a write. */
async function storeRules(env, body, expectedRev) {
	if (!env.xyro_tags || typeof env.xyro_tags.prepare !== "function") {
		throw new ApiError(503, "no rules database is bound to this Worker");
	}
	const res = await env.xyro_tags
		.prepare(
			"INSERT INTO rules (id, body, rev, updated_at) VALUES (1, ?, 1, ?) " +
			"ON CONFLICT(id) DO UPDATE SET body = excluded.body, rev = rules.rev + 1, updated_at = excluded.updated_at " +
			"WHERE rules.rev = ?"
		)
		.bind(body, Math.floor(Date.now() / 1000), expectedRev)
		.run();
	const changed = res && res.meta ? Number(res.meta.changes) || 0 : 0;
	return changed > 0;
}

async function serveNametags(env, ctx, url) {
	const fresh = url.searchParams.has("fresh");
	return cached(env, ctx, url, fresh ? 0 : 30, "application/json; charset=utf-8", async () => {
		let stored = null;
		try {
			stored = await storedRules(env);
		} catch (err) {
			// a database problem must not take the tags down: the repo copy still
			// answers, and the status page says which one is being served
			console.error("[rules] database read failed:", err && err.message ? err.message : err);
		}
		if (stored) {
			parseRules(stored.body, "the stored rules");
			// `d1-<rev>` rather than a bare number: it cannot be mistaken for a git
			// blob sha, so a publish knows which guard it is holding
			return {
				body: stored.body,
				contentType: "application/json; charset=utf-8",
				headers: { "x-xyro-sha": "d1-" + stored.rev },
			};
		}
		const file = await repoBytes(env, NAMETAGS_FILE, fresh);
		const body = new TextDecoder("utf-8").decode(file.bytes);
		parseRules(body, NAMETAGS_FILE);
		// The blob sha, when the read went through the GitHub API: the editor
		// sends it back on a publish so a stale tab cannot clobber a newer
		// revision. Absent on the raw path, which is why `PUT` falls back to
		// reading the current sha itself.
		return {
			body,
			contentType: "application/json; charset=utf-8",
			headers: file.sha ? { "x-xyro-sha": file.sha } : {},
		};
	});
}

/** Scopes that turn a leaked token from a REPO problem into an ACCOUNT problem.
 *
 *  GitHub sends `x-oauth-scopes` for classic tokens and nothing at all for
 *  fine-grained ones, which is how the two can be told apart without asking the
 *  user - a classic token cannot be limited to one repository, so a copy of it
 *  can delete repos, add SSH keys or edit org membership. Worth shouting about
 *  on the one route where a human is about to trust the token. */
// Only the ones that can DESTROY or take over: a scope list padded with mild
// account-level grants (gist, notifications, project) would bury the point.
const BROAD_SCOPES = [
	"delete_repo", "admin:org", "admin:enterprise", "admin:public_key",
	"admin:ssh_signing_key", "admin:repo_hook", "admin:gpg_key", "workflow",
	"write:packages", "delete:packages", "write:network_configurations",
	"audit_log", "write:discussion",
];

/** Content types the media route will serve. A whitelist, not a guess: this
 *  route reads a repo path, so an unexpected extension is refused rather than
 *  passed through as an opaque blob. */
const MEDIA_TYPES = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	mp3: "audio/mpeg",
};

/** GET /media/<file> - the seals, the verified badge and any other tag artwork,
 *  served from the same origin as the rules.
 *
 *  This is the half that used to ride jsDelivr, whose edge could hold a stale
 *  copy for days; a seal that does not update reads as "my badge colour is
 *  wrong", which is impossible to debug from inside the game. Long cache is
 *  safe because these files are immutable once named, and `?fresh=1` overrides
 *  it for the editor's previews. */
async function serveMedia(env, ctx, url, name) {
	const ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1];
	const type = ext ? MEDIA_TYPES[ext.toLowerCase()] : null;
	if (!type) throw new ApiError(404, "unsupported media type: " + name);
	const fresh = url.searchParams.has("fresh");
	return cached(env, ctx, url, fresh ? 0 : 300, type, async () => {
		const file = await repoBytes(env, "media/" + name, fresh);
		return file.bytes;
	});
}

/** base64 for the contents API, chunked so a large file cannot blow the stack. */
function toBase64(bytes) {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

/** Owner-or-publisher key check for the nametag write routes.
 *
 *  The ADMIN key always works. A second, lesser secret - XYRO_PUBLISH_KEY -
 *  also works, and can do *only* this: publishing tag rules. That exists
 *  because the admin key also trips the kill switch and edits the blacklist,
 *  and this key ends up saved in a browser; if you would rather a leaked
 *  browser key could not shut the script down for everyone, set
 *  XYRO_PUBLISH_KEY and put that in the editor instead. */
function publishKeyResponse(req, url, env) {
	const supplied = keyOf(req, url);
	if (env.XYRO_ADMIN_KEY && safeEqual(supplied, env.XYRO_ADMIN_KEY)) return null;
	if (env.XYRO_PUBLISH_KEY && safeEqual(supplied, env.XYRO_PUBLISH_KEY)) return null;
	if (!env.XYRO_ADMIN_KEY && !env.XYRO_PUBLISH_KEY) {
		return json(env, { error: "no publish key configured - set XYRO_ADMIN_KEY (owner) or XYRO_PUBLISH_KEY (publish only)" }, 503);
	}
	return json(env, { error: "forbidden: this route needs the owner key" }, 403);
}

/** POST /nametags/check - the editor's "Save & test" for the owner key.
 *
 *  Changes nothing. It answers two questions a key check alone cannot: is this
 *  key accepted, and can this Worker actually reach the repo with its own
 *  GH_TOKEN. A fine-grained token that is read-only passes the read below and
 *  fails at publish time - the message says so rather than pretending. */
async function checkPublishReady(env) {
	/* With the rules database bound, publishing needs NO repo token: the rules are
	   a row this Worker owns, and the guard is the row's revision. So the answer
	   to "can this publish?" is yes, and the useful thing to report is whether
	   the database actually answers - a binding that is not applied yet would
	   otherwise look identical to a healthy one. */
	if (env.xyro_tags && typeof env.xyro_tags.prepare === "function") {
		try {
			const stored = await storedRules(env);
			return json(env, {
				ok: true,
				store: "database",
				sha: stored ? "d1-" + stored.rev : "d1-0",
				rules: stored ? "published (" + stored.body.length + " bytes)" : "empty - the repo file seeds it",
				token: { kind: "none", scopes: [], wide: [] },
				note: "no repo token is involved: the rules live in this Worker's own database" + (env.GH_TOKEN ? " (a GH_TOKEN is also set, so publishes are mirrored to the repo)" : ""),
			});
		} catch (err) {
			return json(env, {
				ok: false,
				reason: "database",
				error: "the rules database is bound but did not answer: " + (err && err.message ? err.message : String(err)) + " - if the table is missing, run: npx wrangler d1 execute xyro-tags --remote --file schema.sql",
			}, 502);
		}
	}
	if (!env.GH_TOKEN) {
		return json(env, {
			ok: false,
			reason: "no_store",
			error: "this Worker can neither store the rules itself nor commit them: bind the rules database (wrangler.toml) or set GH_TOKEN - see api/README.md section 7",
		}, 503);
	}
	const ref = repoRef(env);
	try {
		const res = await fetch("https://api.github.com/repos/" + ref.owner + "/" + ref.repo + "/contents/" + NAMETAGS_FILE +
			"?ref=" + ref.branch + "&t=" + Date.now(), {
			headers: {
				authorization: "Bearer " + env.GH_TOKEN,
				accept: "application/vnd.github+json",
				"user-agent": "xyro-api",
			},
		});
		if (!res.ok) {
			return json(env, {
				ok: false,
				reason: "github",
				error: "GitHub refused this Worker's GH_TOKEN (" + res.status + ") - it needs Contents: Read and write on " + ref.owner + "/" + ref.repo,
			}, 502);
		}
		const data = await res.json();
		/* What kind of credential is this? A fine-grained token sends no scope
		   header at all; a classic one always does, and its scope list is the
		   honest answer to "how much would leak if this escaped?". */
		const scopeHeader = res.headers.get("x-oauth-scopes") || "";
		const scopes = scopeHeader.split(",").map(s => s.trim()).filter(Boolean);
		const wide = scopes.filter(s => BROAD_SCOPES.includes(s));
		const token = scopes.length
			? { kind: "classic", scopes, wide }
			: { kind: "fine-grained", scopes: [], wide: [] };
		return json(env, {
			ok: true,
			sha: data && data.sha ? data.sha : "",
			bytes: data && data.size ? data.size : 0,
			token,
			warning: scopes.length
				? "this is a CLASSIC token, which cannot be limited to one repository" +
					(wide.length ? " and it carries " + wide.join(", ") : "") +
					" - a leak affects your whole account (repos, SSH keys, org), not just these tags. Replace it with a fine-grained token (Contents: Read and write on " + ref.owner + "/" + ref.repo + ")."
				: "",
			note: "a read-only token gets this far and is refused on the first publish",
		});
	} catch (err) {
		return json(env, { ok: false, reason: "network", error: "could not reach GitHub: " + (err && err.message ? err.message : String(err)) }, 502);
	}
}

/** PUT /nametags - publish the rules THROUGH this Worker, so the editor no
 *  longer needs a GitHub login in the browser.
 *
 *  Owner-only (the admin key) and it needs GH_TOKEN: a fine-grained token with
 *  Contents: Read and write on the repo. Both halves matter - the admin key is
 *  what proves it is you, the token is what makes the commit possible.
 *
 *  A stale editor must not silently clobber a newer revision, so a caller may
 *  send `?sha=`; GitHub then rejects the write with 409 if the file moved on.
 *  Without a sha we read the current one first, which is an explicit overwrite.
 *  Finally the cached copy is dropped, or the next reader would be handed the
 *  revision we just replaced - the exact "it will not keep my changes" bug. */
async function publishNametags(env, req, url) {
	const hasDb = !!(env.xyro_tags && typeof env.xyro_tags.prepare === "function");
	if (!hasDb && !env.GH_TOKEN) {
		return json(env, {
			error: "publishing needs either the rules database (bind it in wrangler.toml and run schema.sql) or GH_TOKEN (a repo token with Contents: Read and write) - see api/README.md",
		}, 503);
	}
	const bodyText = await req.text();
	/* The ceiling is the store's, not a preference. A bound parameter can carry
	   more than an inline SQL statement can ("statement too long: SQLITE_TOOBIG"
	   is about the SQL text, which is why this is measured on the value), and a
	   rules file that embeds an image is legitimately megabytes. What matters is
	   that the limit is one the store accepts, and that exceeding it says WHY. */
	if (bodyText.length > MAX_RULES_BYTES) {
		return json(env, {
			error: "the rules are " + bodyText.length + " bytes, over the " + MAX_RULES_BYTES + " byte limit for this store",
			hint: "embedded images are what make a rules file this big - move them into media/ and reference them by URL, which also makes every client's poll much smaller",
		}, 413);
	}
	let parsed = null;
	try {
		parsed = JSON.parse(bodyText);
	} catch {
		parsed = null;
	}
	if (!parsed || !Array.isArray(parsed.tags) || !parsed.options || typeof parsed.options !== "object") {
		return json(env, { error: 'rules must be {"options":{...},"tags":[...]}' }, 400);
	}

	/* The database is the live copy, so that is where a publish goes. It needs
	   no token: the compare-and-set below is the guard, and the owner key is the
	   only credential involved. The repo commit that follows is an OPTIONAL
	   mirror - it keeps nametags.json (and therefore git history) current when a
	   token happens to exist, and its failure never fails the publish, because
	   by then the rules are already live. */
	if (hasDb) {
		const sent = url.searchParams.get("sha") || "";
		const fromClient = /^d1-(\d+)$/.exec(sent);
		let expected = fromClient ? Number(fromClient[1]) : 0;
		if (!fromClient) {
			// the editor read the rules from the repo (or sent a git sha), so its
			// guard is not ours to use: take the current revision instead. The
			// window between this read and the write is milliseconds, and the
			// statement itself still refuses a row that moved underneath it.
			const current = await storedRules(env).catch(() => null);
			expected = current ? current.rev : 0;
		}
		let ok = false;
		try {
			ok = await storeRules(env, bodyText, expected);
		} catch (err) {
			const msg = err && err.message ? err.message : String(err);
			/* A body the store refuses for its SIZE is not a server fault, and the
			   difference matters: it is the one failure a publisher can fix. */
			if (/TOOBIG|too large|statement too long/i.test(msg)) {
				return json(env, {
					error: "the rules database refused a " + bodyText.length + " byte document: " + msg,
					size: bodyText.length,
					hint: "embedded images make a rules file this big - move them into media/ and reference them by URL; the repo-served path (GH_TOKEN) has no such limit",
				}, 413);
			}
			return json(env, { error: msg }, err && err.status ? err.status : 502);
		}
		if (!ok) {
			return json(env, {
				error: "the rules moved on before this publish landed (revision " + expected + " is no longer current)",
			}, 409);
		}
		await clearRulesCache(url.origin);
		let mirror = "skipped (no GH_TOKEN)";
		if (env.GH_TOKEN) {
			mirror = await mirrorToRepo(env, bodyText).catch(err => "failed: " + (err && err.message ? err.message : err));
		}
		const stored = await storedRules(env).catch(() => null);
		return json(env, {
			ok: true,
			sha: stored ? "d1-" + stored.rev : "d1-" + (expected + 1),
			bytes: bodyText.length,
			store: "database",
			repo_mirror: mirror,
		});
	}

	/* No database bound: the repo file IS the store, so this is the git path
	   exactly as it was - and it still needs GH_TOKEN, because committing to a
	   repo needs a repo credential however you slice it. */
	const out = await commitRepo(env, bodyText, url.searchParams.get("sha") || "");
	if (!out.ok) {
		return json(env, { error: "github " + out.status + (out.detail || "") }, out.status === 409 ? 409 : 502);
	}
	await clearRulesCache(url.origin);
	return json(env, { ok: true, sha: out.sha, bytes: bodyText.length, store: "repo" });
}

/** Drop the cached copies of the rules, so the next reader anywhere gets the
 *  revision that was just written rather than the one from up to 30s ago. */
async function clearRulesCache(origin) {
	if (typeof caches === "undefined" || !caches.default) return;
	for (const alias of ["/nametags", "/nametags.json", "/config"]) {
		await caches.default.delete(new Request(origin + alias)).catch(() => {});
	}
}

/** Commit the rules to nametags.json in the repo.
 *
 *  Used for the git-only store, and as the OPTIONAL mirror when the database is
 *  the live copy. `sha` empty means "find the current blob sha first": GitHub
 *  refuses a write with no sha to a file that already exists, and a mirror has
 *  no sha to hand because it did not read the file. */
async function commitRepo(env, bodyText, sha) {
	if (!env.GH_TOKEN) return { ok: false, status: 503, detail: " (no GH_TOKEN)" };
	const ref = repoRef(env);
	const base = "https://api.github.com/repos/" + ref.owner + "/" + ref.repo + "/contents/" + NAMETAGS_FILE;
	const headers = {
		authorization: "Bearer " + env.GH_TOKEN,
		accept: "application/vnd.github+json",
		"user-agent": "xyro-api",
	};
	if (!sha) {
		try {
			const cur = await fetch(base + "?ref=" + ref.branch + "&t=" + Date.now(), { headers });
			if (cur.ok) {
				const curJson = await cur.json();
				if (curJson && curJson.sha) sha = curJson.sha;
			}
		} catch {
			/* the PUT below reports whatever is really wrong */
		}
	}
	const put = await fetch(base, {
		method: "PUT",
		headers: { ...headers, "content-type": "application/json" },
		body: JSON.stringify({
			message: "Publish nametags via the Xyro API",
			content: toBase64(new TextEncoder().encode(bodyText)),
			branch: ref.branch,
			...(sha ? { sha } : {}),
		}),
	});
	const out = await put.json().catch(() => ({}));
	if (!put.ok) {
		return { ok: false, status: put.status, detail: out && out.message ? ": " + out.message : "" };
	}
	return { ok: true, status: put.status, sha: out && out.content ? (out.content.sha || "") : "" };
}

/** Keep the repo copy current when a token exists. Its failure must never fail
 *  the publish: by the time this runs the rules are already live in the
 *  database, so a stale file is a cosmetic problem, not an outage. */
async function mirrorToRepo(env, bodyText) {
	const out = await commitRepo(env, bodyText, "");
	if (!out.ok) throw new Error("github " + out.status + (out.detail || ""));
	return "committed " + (out.sha ? String(out.sha).slice(0, 7) : "ok");
}

/** Edge-cached GET. Cloudflare's cache is keyed on the URL, and `?fresh=1`
 *  bypasses it entirely (raw GitHub alone edge-caches for minutes).
 *
 *  produce() may return the body directly, or `{ body, contentType, headers }`
 *  when the response needs headers only it can know (the nametags route adds
 *  the blob sha that way). */
async function cached(env, ctx, url, ttl, contentType, produce) {
	const fresh = url.searchParams.has("fresh");
	const canCache = typeof caches !== "undefined" && caches.default && !fresh;
	const cacheKey = new Request(url.origin + url.pathname);
	if (canCache) {
		const hit = await caches.default.match(cacheKey);
		/* Never serve an empty cached body. A cache entry is written from
		   whatever was produced at the time, so one bad upstream answer - or one
		   bug in how it was decoded - gets replayed to everybody for the whole
		   TTL, and outlives the deploy that fixed it. An empty body is never
		   legitimate here: the rules file and every piece of artwork have bytes.
		   A miss just re-fetches and re-caches, which is what we want. */
		const cachedLength = Number(hit && hit.headers.get("content-length"));
		if (hit && !(cachedLength === 0)) return hit;
	}
	const out = await produce();
	const spec = out && typeof out === "object" && !ArrayBuffer.isView(out) && !(out instanceof ArrayBuffer) && "body" in out
		? out
		: { body: out };
	const res = new Response(spec.body, {
		headers: {
			"content-type": spec.contentType || contentType,
			...(spec.headers || {}),
			...corsHeaders(env),
			"cache-control": fresh ? "no-store" : "public, max-age=" + ttl,
		},
	});
	if (canCache && ttl > 0) {
		// Storing the response itself (not a clone) is fine - the caller gets the
		// same bytes, and the copy in the cache is keyed by path alone, so the
		// key never leaks into a shared cache entry.
		ctx.waitUntil(caches.default.put(cacheKey, new Response(spec.body, res)));
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
		nametags: {
			rules: "GET /nametags (aliases /nametags.json, /config)",
			media: "GET /media/<file>",
			editor: "GET /editor (self-configuring; /api.json points at it)",
			store: env.xyro_tags ? "the rules database (D1; the repo file seeds it)" : "the repo file only",
			publish: (env.xyro_tags ? "PUT /nametags (owner key; no repo token needed)" : env.GH_TOKEN
				? (env.XYRO_PUBLISH_KEY ? "PUT /nametags (owner key or publish-only key)" : "PUT /nametags (owner key)")
				: "unavailable (bind the rules database, or set GH_TOKEN)"),
			repo_mirror: env.xyro_tags && env.GH_TOKEN ? "committed as well, when it works" : "off",
			check: "POST /nametags/check (owner key)",
		},
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

/** The gate's answer as a plain-text refusal, or null when everyone may load.
 *  Shared by /script and /loader so the two can never disagree about the switch. */
async function gateRefusal(env) {
	const gate = await readGate(env);
	if (gate.enabled) return null;
	return text(env, "Xyro is disabled" + (gate.message ? ": " + gate.message : "") + "\n", 403);
}

/** Rewrite the loader's own two constants from the request it is served on: the
 *  API URL becomes the origin it was fetched from (so a custom domain or a
 *  local `wrangler dev` both work untouched), and the key becomes whatever this
 *  Worker is currently using - which is what makes the hand-out line short and
 *  a key rotation unable to break a loader anyone already has. */
/** The tag editor, served from this origin.
 *
 *  Same page GitHub Pages publishes, with three differences that are all about
 *  latency rather than looks:
 *    - 60s cache instead of Pages' ~ten minutes, so a new build is one refresh
 *      away instead of a Ctrl+Shift+R and a wait;
 *    - same origin as the API, so a publish is not a cross-origin PUT with an
 *      OPTIONS preflight in front of it;
 *    - the API location is injected into the page, so boot costs one request
 *      for the rules instead of a request for api.json first.
 */
function injectEditorConfig(src, env, origin) {
	const cfg = JSON.stringify({ url: origin, key: env.XYRO_KEY || "" });
	const tag = '<script>window.__XYRO_API=' + cfg + ';</script>';
	if (src.indexOf("</head>") >= 0) return src.replace("</head>", tag + "\n</head>");
	return tag + "\n" + src;
}

function injectLoaderConfig(src, env, origin) {
	const key = env.XYRO_KEY || "";
	return src
		.replace(/^local API = ".*"$/m, 'local API = "' + origin + '"')
		.replace(/^local KEY = ".*"$/m, 'local KEY = "' + key + '"');
}

/** GET /online -> the current presence list, old beats already filtered out. */
async function online(env, url) {
	const window = Math.min(Math.max(Number(url.searchParams.get("window")) || PRESENCE_WINDOW, 5), 600);
	const data = parseNode(await fb(env, "here"));
	const fresh = freshOnly("here", data, window);
	// newest beat first. This was .sort((a, b) => b - a) on the KEYS, which are
	// usernames: subtracting strings is NaN, a comparator that returns NaN leaves
	// the order untouched, so the "most recent first" promise was never true.
	const names = Object.keys(fresh).sort((a, b) => fresh[b] - fresh[a]);
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

	/* the tag editor itself, at the same origin as the API it talks to */
	if (path === "/editor" && req.method === "GET") {
		return cached(env, ctx, url, 60, "text/html; charset=utf-8", async () =>
			injectEditorConfig(await repoFile(env, "index.html", url.searchParams.has("fresh")), env, url.origin)
		);
	}
	/* What the editor reads to find the API. On GitHub Pages this is a file in
	   the repo; here it is generated, so a page served from this origin points
	   at itself with no cross-origin detour and nothing to keep in step. */
	if (path === "/api.json" && req.method === "GET") {
		return json(env, { api: { url: url.origin, key: env.XYRO_KEY || "" } }, 200, {
			"cache-control": "public, max-age=60",
		});
	}

	if (path === "/version") {
		return cached(env, ctx, url, 60, "text/plain; charset=utf-8", () => repoFile(env, "version.txt", url.searchParams.has("fresh")));
	}
	/* the nametags themselves: the rules and every piece of tag artwork, from
	   this origin. /config stays as an alias - it is what the status page, the
	   docs and the first cut of the editor already point at, and it is the same
	   file, so there is no second thing to keep in step. */
	if ((path === "/nametags" || path === "/nametags.json" || path === "/config") && req.method === "GET") {
		return serveNametags(env, ctx, url);
	}
	if (path === "/nametags/check" && (req.method === "POST" || req.method === "GET")) {
		const denied = publishKeyResponse(req, url, env);
		if (denied) return denied;
		return checkPublishReady(env);
	}
	if (path === "/nametags" && (req.method === "PUT" || req.method === "POST")) {
		// the admin key OR the publish-only key - see publishKeyResponse
		const denied = publishKeyResponse(req, url, env);
		if (denied) return denied;
		if (writeThrottled(req)) return json(env, { error: "too many writes, slow down" }, 429);
		return publishNametags(env, req, url);
	}
	/* tag artwork: seals, the verified badge, backgrounds. The filename is
	   whitelisted by shape (one path segment, known extension) because it is
	   concatenated onto a repo path - `..` never gets the chance to matter. */
	const media = path.match(/^\/media\/([A-Za-z0-9_.-]{1,80})$/);
	if (media && req.method === "GET") {
		return serveMedia(env, ctx, url, media[1]);
	}
	/* the script itself, served from here when a client prefers it: this is what
	   makes the kill switch able to cut a loader off at the source */
	if (path === "/script" && req.method === "GET") {
		if (!readKeyOk(req, url, env)) return json(env, { error: "forbidden: bad or missing key" }, 403);
		const refused = await gateRefusal(env);
		if (refused) return refused;
		return serveScript(env, url);
	}

	/* the loader, so the line you hand out points at this domain instead of at
	   GitHub. Deliberately NOT key-gated: it is what someone pastes before they
	   have anything - a key in a hand-out line would become a secret you cannot
	   rotate without breaking every copy in circulation. The gate still cuts it
	   off, which is the part that matters. */
	if (path === "/loader" && req.method === "GET") {
		const refused = await gateRefusal(env);
		if (refused) return refused;
		const file = env.LOADER_FILE || "custom-loader.lua";
		const bust = url.searchParams.has("fresh");
		return cached(env, ctx, url, 60, "text/plain; charset=utf-8", async () =>
			injectLoaderConfig(await repoFile(env, file, bust), env, url.origin)
		);
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
