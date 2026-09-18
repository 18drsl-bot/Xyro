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
 *      GET    /health                        -> config self-report
 *      GET    /version                       -> version.txt from the repo
 *      GET    /config                        -> nametags.json from the repo
 *      GET    /staff                         -> the staff object
 *      GET    /blacklist                     -> just the blacklist map
 *      POST   /blacklist/<who>               (key required) body = reason text
 *      DELETE /blacklist/<who>               (key required)
 *      GET    /online                        -> { count, online[], beats{} }
 *
 * Auth
 * ----
 * One key: send it as the `x-api-key` header, or `?key=` when the caller can
 * only do a plain GET (executors' game:HttpGet cannot set headers).
 *   - reads  are gated only when XYRO_KEY is set (the data is public anyway;
 *            gating it costs nothing and stops casual scraping of the DB)
 *   - writes FAIL CLOSED: with no XYRO_KEY configured they return 503 rather
 *            than silently accepting anonymous writes
 * A key shipped inside a Lua client is not a secret - it is a speed bump. What
 * it buys you is that the *database credential* never leaves this Worker, so a
 * leaked key gets rotated in one command and the rules stay shut. Anything that
 * must be trustworthy (staff-only writes) has to be authorized server-side -
 * see "Real staff auth" in api/README.md.
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
	if (!env.XYRO_KEY) return true; // unset = open reads (documented in /health)
	return safeEqual(keyOf(req, url), env.XYRO_KEY);
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

function fbAuthSuffix(env) {
	return env.FB_SECRET ? "?auth=" + encodeURIComponent(env.FB_SECRET) : "";
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
		res = await fetch(base + "/" + path + ".json" + fbAuthSuffix(env), init);
	} catch (err) {
		throw new ApiError(502, "database unreachable: " + (err && err.message ? err.message : String(err)));
	}
	const body = await res.text();
	if (!res.ok) {
		throw new ApiError(502, fbErrorText(body) || "database responded " + res.status);
	}
	const denied = fbErrorText(body);
	if (denied) throw new ApiError(502, denied);
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

function health(env, url) {
	return json(env, {
		ok: true,
		service: "xyro-api",
		time: new Date().toISOString(),
		database: fbBase(env) ? "configured" : "missing (set the FB_URL var)",
		database_secret: env.FB_SECRET ? "set" : "not set (fine while rules allow anonymous access)",
		reads: env.XYRO_KEY ? "key required" : "open",
		writes: env.XYRO_KEY ? "key required" : "DISABLED (no XYRO_KEY)",
		nodes: [...NODES],
		presence_window: PRESENCE_WINDOW,
		queue_ttl: QUEUE_TTL,
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
	if (path === "/" || path === "/health") return health(env, url);

	if (path === "/version") {
		return cached(env, ctx, url, 60, "text/plain; charset=utf-8", () => repoFile(env, "version.txt", url.searchParams.has("fresh")));
	}
	if (path === "/config") {
		return cached(env, ctx, url, 60, "application/json; charset=utf-8", () => repoFile(env, "nametags.json", url.searchParams.has("fresh")));
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
		const denied = writeKeyResponse(req, url, env);
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
