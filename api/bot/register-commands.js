#!/usr/bin/env node
/**
 * register-commands.js - tell Discord which slash commands this bot has.
 *
 *   node api/bot/register-commands.js            # register (guild, if set; else global)
 *   node api/bot/register-commands.js --global   # force global registration
 *   node api/bot/register-commands.js --delete   # remove every command
 *   node api/bot/register-commands.js --list     # show what Discord currently has
 *
 * Run this from your own machine, not from the Worker: it needs the bot TOKEN,
 * which is a full account credential for the bot and must never be a secret on
 * the Worker. The Worker only needs the PUBLIC key, which is public by design.
 *
 * Env (bot token and app id, from the Discord Developer Portal):
 *   DISCORD_TOKEN           Bot -> Reset/Copy token
 *   DISCORD_APPLICATION_ID  General Information -> Application ID
 *   DISCORD_GUILD_ID        optional; registering to a GUILD updates instantly,
 *                           while global commands can take up to an hour to show
 *                           up. Use the guild while testing.
 *
 * Why this is separate from deploying: commands are state on Discord's side, not
 * something your code can declare at runtime. Deploying the Worker does not
 * change them, and running this does not touch the Worker.
 */
import { COMMANDS } from "./commands.js";

const token = String(process.env.DISCORD_TOKEN || "").trim();
const appId = String(process.env.DISCORD_APPLICATION_ID || "").trim();
const guildId = String(process.env.DISCORD_GUILD_ID || "").trim();

const args = new Set(process.argv.slice(2));
const global = args.has("--global") || !guildId;
const del = args.has("--delete");
const list = args.has("--list");

function fail(msg) {
	console.error("x " + msg);
	process.exit(1);
}

if (!token) fail("DISCORD_TOKEN is not set (Developer Portal -> Bot -> Reset Token)");
if (!appId) fail("DISCORD_APPLICATION_ID is not set (Developer Portal -> General Information)");

const base = "https://discord.com/api/v10/applications/" + appId;
const url = global ? base + "/commands" : base + "/guilds/" + guildId + "/commands";
const headers = { authorization: "Bot " + token, "content-type": "application/json", "user-agent": "xyro-bot" };

/** Discord answers 429 with a retry_after, in seconds. One retry is enough: this
 *  runs once, by hand, against a shared rate limit. */
async function send(method, body) {
	let res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	if (res.status === 429) {
		const info = await res.json().catch(() => ({}));
		const wait = Math.min(Number(info.retry_after) || 2, 30);
		console.log("  rate limited - waiting " + wait + "s");
		await new Promise(r => setTimeout(r, wait * 1000));
		res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	}
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* keep the text */
	}
	return { status: res.status, json, text };
}

const scope = global ? "GLOBAL (can take up to an hour to appear)" : "guild " + guildId + " (instant)";

if (list) {
	const res = await send("GET");
	if (res.status !== 200) fail("could not list commands: " + res.status + " " + res.text.slice(0, 300));
	const names = (res.json || []).map(c => c.name);
	console.log(scope);
	console.log(names.length ? "  registered: " + names.join(", ") : "  (none)");
	process.exit(0);
}

if (del) {
	const res = await send("PUT", []);
	if (res.status !== 200) fail("could not clear commands: " + res.status + " " + res.text.slice(0, 300));
	console.log("cleared every command for " + scope);
	process.exit(0);
}

const res = await send("PUT", COMMANDS);
if (res.status !== 200) fail("registration failed: " + res.status + " " + res.text.slice(0, 500));

console.log("registered " + (res.json || []).length + " commands for " + scope);
for (const c of res.json || []) {
	const subs = (c.options || []).filter(o => o.type === 1).map(o => o.name);
	console.log("  /" + c.name + (subs.length ? " " + subs.join("|") : ""));
}
console.log("\nNext: set the Interactions Endpoint URL in the Developer Portal to your Worker,");
console.log("e.g. https://xyro-bot.<your-subdomain>.workers.dev  (see ../DISCORD-BOT.md)");
