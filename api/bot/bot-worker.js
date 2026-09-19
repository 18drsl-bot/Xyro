/**
 * bot-worker.js - a Discord bot that runs on Cloudflare, with no gateway.
 *
 * WHY THIS SHAPE. Discord offers two ways to build a bot:
 *
 *   1. the GATEWAY - your process opens a persistent WebSocket and Discord
 *      streams every event down it. Needs an always-on host.
 *   2. the HTTP INTERACTIONS endpoint - Discord POSTs each slash command to a
 *      URL you own. Needs nothing that stays alive.
 *
 * Cloudflare Workers can only do (2). That is not a documentation gap: Discord
 * deliberately refuses gateway connections from Cloudflare's shared egress
 * addresses, so a gateway bot simply cannot be hosted here. What (2) costs you
 * is everything that only exists on the gateway - message events (`!prefix`
 * commands, autoresponders, logging), member join/leave, presence, and status
 * changes. Slash commands, buttons, modals and autocomplete all work.
 *
 * So this is the right host if your bot is slash commands and moderation, and
 * the wrong host if it reads chat. See ../DISCORD-BOT.md.
 *
 * WHAT IT DOES. Verifies Discord's Ed25519 signature, answers the PING that the
 * Developer Portal uses to validate the endpoint, and routes /nametag, /block
 * and /unblock to the Xyro API using the owner key.
 *
 * Deploy: see ../DISCORD-BOT.md - "Hosting the bot on Cloudflare".
 */
const XYRO_TIMEOUT_MS = 8000;

/* Discord interaction types we answer. */
const PING = 1;
const APPLICATION_COMMAND = 2;
/* response types */
const PONG = 1;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
/* 64 = ephemeral: only the person who ran the command sees it */
const EPHEMERAL = 64;

/* Permission bits we accept for a mutating command. The endpoint URL is public,
   so this is enforced HERE and not just in the command definition: Discord's
   `default_member_permissions` is a client-side hint that hides the command, and
   a hidden command can still be invoked by anything that can post an
   interaction - including in a server you did not intend. */
const ADMINISTRATOR = 1n << 3n;
const MANAGE_ROLES = 1n << 28n;

function hexToBytes(hex) {
	const clean = String(hex || "").trim();
	if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) return null;
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
	return out;
}

/** Verify Discord's signature over `timestamp + body`.
 *
 *  Exported so it can be tested with real key material: this is the one check
 *  that makes the endpoint safe to expose, and "it runs" is not evidence that it
 *  rejects a forged request.
 *
 *  The algorithm name is tried in both spellings. Workers implement the standard
 *  Secure Curves `Ed25519`, and also keep the older non-standard `NODE-ED25519`
 *  for raw public keys; Node implements only `Ed25519`. Trying both means the
 *  same file runs in the Worker and in tests, instead of the deployed thing
 *  being the one path nobody exercises. */
async function verifySignature(rawBody, signatureHex, timestamp, publicKeyHex, opts = {}) {
	const signature = hexToBytes(signatureHex);
	const publicKey = hexToBytes(publicKeyHex);
	if (!signature || !publicKey || !timestamp) return false;

	/* A replayed request stays valid forever, because the signature covers the
	   timestamp Discord sent rather than the one you received it at. Checking the
	   age is what makes a captured request useless a minute later. */
	const maxAge = opts.maxAgeSeconds == null ? 300 : Number(opts.maxAgeSeconds);
	if (maxAge > 0) {
		const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
		if (!Number.isFinite(age) || age > maxAge) return false;
	}

	const message = new TextEncoder().encode(timestamp + rawBody);
	for (const name of ["Ed25519", "NODE-ED25519"]) {
		try {
			const algorithm = name === "NODE-ED25519" ? { name, namedCurve: name } : { name };
			const key = await crypto.subtle.importKey("raw", publicKey, algorithm, false, ["verify"]);
			if (await crypto.subtle.verify(algorithm, key, signature, message)) return true;
		} catch {
			/* not supported in this runtime - try the other spelling */
		}
	}
	return false;
}

/* ------------------------------------------------------------ rule shaping
 *
 * The same rules-as-an-array logic the Node client and the web editor use, with
 * one invariant that is easy to get wrong and impossible to see: rules match
 * FIRST-WINS in array order, so a new rule placed after a "*" catch-all can
 * never fire. It sits in the document, renders correctly in the editor, and does
 * nothing in game. Tools/test_bot_worker.js asserts this module and
 * nametags-client.js produce the same order for the same inputs.
 */
function shapeRules(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("the rules must be an object");
	if (!value.options || typeof value.options !== "object" || Array.isArray(value.options)) throw new Error('the rules need an "options" object');
	if (!Array.isArray(value.tags)) throw new Error('the rules need a "tags" array');
	return { options: value.options, tags: value.tags };
}

function findRule(rules, match) {
	const want = String(match == null ? "" : match).trim().toLowerCase();
	if (!want) return null;
	return (shapeRules(rules).tags || []).find(t => String((t && t.match) || "").trim().toLowerCase() === want) || null;
}

function listRules(rules) {
	return (shapeRules(rules).tags || []).map(t => String((t && t.match) || ""));
}

function setRule(rules, rule) {
	const doc = shapeRules(rules);
	if (!rule || typeof rule !== "object") throw new Error("a rule must be an object");
	const match = String(rule.match == null ? "" : rule.match).trim();
	if (!match) throw new Error('a rule needs a "match"');
	const next = { ...rule, match };
	const at = doc.tags.findIndex(t => String((t && t.match) || "").trim().toLowerCase() === match.toLowerCase());
	if (at >= 0) {
		doc.tags[at] = next;
		return doc;
	}
	const star = doc.tags.findIndex(t => (t && t.match) === "*");
	if (star >= 0) doc.tags.splice(star, 0, next);
	else doc.tags.push(next);
	return doc;
}

function removeRule(rules, match) {
	const doc = shapeRules(rules);
	const want = String(match == null ? "" : match).trim().toLowerCase();
	const at = doc.tags.findIndex(t => String((t && t.match) || "").trim().toLowerCase() === want);
	if (at < 0) return false;
	doc.tags.splice(at, 1);
	return true;
}

/* ------------------------------------------------------------- the Xyro API */

function xyro(env, fetchImpl) {
	const base = String(env.XYRO_API_URL || "").replace(/\/+$/, "");
	const key = String(env.XYRO_ADMIN_KEY || "");
	const doFetch = fetchImpl || fetch;

	if (!base) throw new Error("XYRO_API_URL is not set (npx wrangler secret put XYRO_API_URL)");
	if (!key) throw new Error("XYRO_ADMIN_KEY is not set (npx wrangler secret put XYRO_ADMIN_KEY)");

	async function call(method, route, body) {
		const headers = { "x-api-key": key, "x-xyro-by": "discord-bot" };
		if (body !== undefined) headers["content-type"] = "application/json";
		/* The Worker answers well under a second, but a hung upstream must not
		   hang the interaction: Discord gives the whole request ~3 seconds, and a
		   timeout here becomes a clear message instead of "the application did
		   not respond". */
		const abort = typeof AbortController === "function" ? new AbortController() : null;
		const timer = abort ? setTimeout(() => abort.abort(), XYRO_TIMEOUT_MS) : null;
		let res;
		try {
			res = await doFetch(base + route, { method, headers, body, signal: abort ? abort.signal : undefined });
		} catch (err) {
			throw new Error("the Xyro API did not answer (" + (err && err.message ? err.message : err) + ")");
		} finally {
			if (timer) clearTimeout(timer);
		}
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			/* not JSON - the text goes into the error */
		}
		return { status: res.status, json, text, rev: (res.headers && res.headers.get && res.headers.get("x-xyro-sha")) || "" };
	}

	return {
		base,
		async read() {
			const res = await call("GET", "/nametags?fresh=1");
			if (res.status !== 200 || !res.json) {
				/* carry the API's own reason through. "could not read the tags: 500"
				   is a dead end for whoever is looking at the Discord reply; the
				   Worker's message usually names the thing to fix (a missing secret, a
				   refused key, a database that is not bound). */
				throw new Error("could not read the tags: " + res.status + " " + ((res.json && res.json.error) || res.text.slice(0, 160)));
			}
			return { rules: shapeRules(res.json), rev: res.rev };
		},
		/** read, change, publish. A 409 means someone published in between, and
		 *  the change is re-applied on THEIR revision rather than clobbering it -
		 *  the bot and the web editor are used at the same time in practice. */
		async edit(change, attempts = 3) {
			let last = null;
			for (let i = 0; i < attempts; i++) {
				const { rules, rev } = await this.read();
				const next = (await change(rules)) || rules;
				const route = "/nametags" + (rev ? "?sha=" + encodeURIComponent(rev) : "");
				const res = await call("PUT", route, JSON.stringify({ options: next.options, tags: next.tags }));
				if (res.status === 409) {
					last = new Error("the tags changed while this was publishing");
					continue;
				}
				if (res.status !== 200 || !res.json || res.json.ok !== true) {
					throw new Error((res.json && res.json.error) || "publish failed: " + res.status);
				}
				return { rev: res.json.sha, bytes: res.json.bytes };
			}
			throw last || new Error("the tags kept changing under this edit");
		},
		async block(who, reason) {
			const res = await call("POST", "/blacklist/" + encodeURIComponent(who), String(reason || "").slice(0, 200));
			return { ok: res.status === 200 && !!(res.json && res.json.ok), detail: res.json || res.text.slice(0, 200) };
		},
		async unblock(who) {
			const res = await call("DELETE", "/blacklist/" + encodeURIComponent(who));
			return { ok: res.status === 200 && !!(res.json && res.json.ok), detail: res.json || res.text.slice(0, 200) };
		},
	};
}

/* ------------------------------------------------------------- the commands */

function optionMap(interaction) {
	const out = {};
	const collect = list => {
		for (const o of list || []) {
			if (o.type === 1 || o.type === 2) collect(o.options);
			else out[o.name] = o.value;
		}
	};
	collect((interaction.data && interaction.data.options) || []);
	return out;
}

function reply(content) {
	return new Response(JSON.stringify({ type: CHANNEL_MESSAGE_WITH_SOURCE, data: { content: String(content).slice(0, 1900), flags: EPHEMERAL } }), {
		headers: { "content-type": "application/json" },
	});
}

/** Can this member run a mutating command? The guild owner can always; otherwise
 *  it takes Administrator or Manage Roles. */
function mayManage(interaction) {
	const member = interaction.member;
	if (!member) return false;
	if (interaction.guild && interaction.guild.owner_id && String(interaction.guild.owner_id) === String(member.user && member.user.id)) return true;
	try {
		const bits = BigInt(String(member.permissions || "0"));
		return (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & MANAGE_ROLES) === MANAGE_ROLES;
	} catch {
		return false;
	}
}

async function runCommand(interaction, env, fetchImpl) {
	const name = (interaction.data && interaction.data.name) || "";
	const sub = ((interaction.data && interaction.data.options) || []).find(o => o.type === 1);
	const verb = sub ? sub.name : "";
	const args = optionMap(interaction);

	if (name === "nametag" && verb === "list") {
		const api = xyro(env, fetchImpl);
		const { rules, rev } = await api.read();
		const lines = (rules.tags || []).map((t, i) => `${i + 1}. \`${t.match}\` -> **${t.label}**${t.badge ? " (verified)" : ""}`);
		if (!lines.length) return reply("No tags published yet.");
		/* an interaction response is capped, so say so rather than being cut off
		   mid-tag with no explanation */
		return reply(truncate(lines.join("\n"), 1800) + "\n\nrevision " + rev);
	}

	if (!mayManage(interaction)) {
		return reply("You need **Manage Roles** (or Administrator) to change tags.");
	}

	if (name === "nametag" && verb === "set") {
		const user = String(args.user || "").trim();
		const label = String(args.label || "").trim();
		const color = String(args.color || "#6C80FF").trim();
		if (!user || user.length > 32) return reply("Give a Roblox username or user id (32 characters or fewer).");
		if (!label || label.length > 40) return reply("Give the text the tag shows (40 characters or fewer).");
		if (!/^#[0-9a-fA-F]{6}$/.test(color)) return reply(`\`${color}\` is not a hex colour like \`#6C80FF\`.`);
		const api = xyro(env, fetchImpl);
		const out = await api.edit(r => {
			setRule(r, { match: user, label, color, badge: args.badge === true ? true : undefined });
		});
		return reply(`Tag set for \`${user}\`: **${label}**. In game within ~15s (revision ${out.rev}).`);
	}

	if (name === "nametag" && verb === "remove") {
		const user = String(args.user || "").trim();
		const api = xyro(env, fetchImpl);
		let removed = false;
		await api.edit(r => {
			removed = removeRule(r, user);
		});
		return reply(removed ? `Removed the tag for \`${user}\`.` : `There is no rule matching \`${user}\`.`);
	}

	if (name === "block") {
		const who = String(args.who || "").trim();
		if (!/^[A-Za-z0-9_]{1,32}$/.test(who)) return reply("A Roblox username or numeric user id, letters/numbers/underscore only.");
		const api = xyro(env, fetchImpl);
		const out = await api.block(who, String(args.reason || ""));
		return reply(out.ok ? `Blocked \`${who}\`. The script refuses to load for them.` : "Could not block: " + JSON.stringify(out.detail));
	}

	if (name === "unblock") {
		const who = String(args.who || "").trim();
		if (!/^[A-Za-z0-9_]{1,32}$/.test(who)) return reply("A Roblox username or numeric user id, letters/numbers/underscore only.");
		const api = xyro(env, fetchImpl);
		const out = await api.unblock(who);
		return reply(out.ok ? `Unblocked \`${who}\`.` : "Could not unblock: " + JSON.stringify(out.detail));
	}

	return reply("Unknown command.");
}

function truncate(text, max) {
	return text.length <= max ? text : text.slice(0, max - 20) + "\n... (truncated)";
}

/** The whole request path, separated from fetch() so a test can drive it with a
 *  plain interaction body and a stubbed upstream. */
async function handleInteraction(rawBody, headers, env, fetchImpl) {
	const signature = headers.get("x-signature-ed25519");
	const timestamp = headers.get("x-signature-timestamp");
	const ok = await verifySignature(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY, {
		maxAgeSeconds: env.SIGNATURE_MAX_AGE == null ? 300 : Number(env.SIGNATURE_MAX_AGE),
	});
	if (!ok) {
		/* 401 is what the Developer Portal expects when it validates the endpoint
		   URL, and it is the only answer a forged request ever gets. */
		return new Response("invalid request signature", { status: 401 });
	}

	let interaction;
	try {
		interaction = JSON.parse(rawBody);
	} catch {
		return new Response("bad request body", { status: 400 });
	}

	if (interaction.type === PING) return new Response(JSON.stringify({ type: PONG }), { headers: { "content-type": "application/json" } });
	if (interaction.type !== APPLICATION_COMMAND) return reply("Unsupported interaction type.");

	/* optional lock: if a guild is configured, only that guild's commands are
	   honoured. The endpoint is public, so this is the difference between "my
	   server's bot" and "anyone who installed my bot". */
	if (env.DISCORD_GUILD_ID && String(interaction.guild_id || "") !== String(env.DISCORD_GUILD_ID)) {
		return reply("This bot is not configured for this server.");
	}

	try {
		return await runCommand(interaction, env, fetchImpl);
	} catch (err) {
		/* Answer with the reason. A 500 leaves Discord showing "the application
		   did not respond", which says nothing about what to fix. */
		console.error("xyro bot command failed:", err && err.stack ? err.stack : err);
		return reply("Failed: " + (err && err.message ? err.message : String(err)));
	}
}

export default {
	async fetch(request, env, ctx) {
		if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
		/* read ONCE, as text: the signature covers these exact bytes, so a parsed
		   and re-serialised body would not verify */
		const raw = await request.text();
		return handleInteraction(raw, request.headers, env || {}, (env && env.fetchImpl) || fetch);
	},
};

export { verifySignature, hexToBytes, handleInteraction, runCommand, shapeRules, findRule, listRules, setRule, removeRule, optionMap, mayManage };
