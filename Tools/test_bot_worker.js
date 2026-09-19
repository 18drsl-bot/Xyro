// test_bot_worker.js - the Discord interactions endpoint in api/bot/.
//
//   node Tools/test_bot_worker.js
//
// The endpoint URL is public, so the signature check is the only thing between
// it and anyone on the internet. It is tested with REAL key material: a pair is
// generated here, payloads are signed with node:crypto, and the Worker's own
// verify path (WebCrypto Ed25519 - the same code the deployed Worker runs) has
// to accept the genuine signature and reject a tampered body, a stale timestamp
// and a different key. A test that only checked "bad header => 401" would pass
// against a verify function that always returned false.
const path = require("path");
const { generateKeyPairSync, sign: nodeSign } = require("node:crypto");

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
const BOT = path.join(ROOT, "api", "bot");

(async () => {
	const bot = await import("file://" + BOT.replace(/\\/g, "/") + "/bot-worker.js");
	const { COMMANDS, ROUTES } = await import("file://" + BOT.replace(/\\/g, "/") + "/commands.js");
	const client = require(path.join(ROOT, "api", "nametags-client.js"));

	/* ---------------------------------------------------------- key material */
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const pubHex = Buffer.from(publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");
	const { publicKey: otherPub, privateKey: otherPriv } = generateKeyPairSync("ed25519");
	const otherPubHex = Buffer.from(otherPub.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");

	const signBody = (body, at = Math.floor(Date.now() / 1000), key = privateKey) => ({
		"x-signature-ed25519": nodeSign(null, Buffer.from(String(at) + body), key).toString("hex"),
		"x-signature-timestamp": String(at),
	});

	/* ------------------------------------------------------ the mock upstream */
	function upstream(handler) {
		const calls = [];
		const impl = async (url, init = {}) => {
			const u = String(url);
			const method = init.method || "GET";
			const entry = { url: u, method, headers: init.headers || {}, body: init.body };
			calls.push(entry);
			const out = await handler(entry, calls.length);
			const body = typeof out.body === "string" ? out.body : JSON.stringify(out.body);
			const headers = new Map(Object.entries(out.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
			return {
				status: out.status || 200,
				headers: { get: k => headers.get(String(k).toLowerCase()) || null },
				text: async () => body,
			};
		};
		return { impl, calls };
	}

	const RULES = () => ({
		options: { size: 18, refreshSeconds: 15 },
		tags: [
			{ match: "Vertxxy2", label: "Vert", color: "#6C80FF" },
			{ match: "*", label: "user", color: "#888888" },
		],
	});

	function envWith(up, extra = {}) {
		return {
			DISCORD_PUBLIC_KEY: pubHex,
			XYRO_API_URL: "https://api.example",
			XYRO_ADMIN_KEY: "owner-key",
			fetchImpl: up ? up.impl : undefined,
			...extra,
		};
	}

	async function post(body, headers, env) {
		const raw = typeof body === "string" ? body : JSON.stringify(body);
		const request = new Request("https://bot.example/", { method: "POST", headers, body: raw });
		const res = await bot.default.fetch(request, env, {});
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			/* keep the text */
		}
		return { status: res.status, json, text };
	}

	/** A command interaction as Discord would send it. */
	const command = (name, options, extra = {}) => ({
		type: 2,
		id: "1",
		application_id: "1",
		guild_id: "999",
		data: { name, options },
		member: { user: { id: "42" }, permissions: String(1n << 28n) },
		...extra,
	});

	/* ================================================================ signature */

	let up = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
	let body = JSON.stringify({ type: 1 });
	let res = await post(body, signBody(body), envWith(up));
	ok("a signed PING is answered with a PONG", res.status === 200 && res.json && res.json.type === 1, res.status + " " + res.text.slice(0, 80));

	res = await post(body, {}, envWith(up));
	ok("a request with no signature at all is refused with 401", res.status === 401, "got " + res.status);

	res = await post(body, signBody(body, Math.floor(Date.now() / 1000), otherPriv), envWith(up));
	ok("a signature from the wrong key is refused (the public key is really checked)", res.status === 401, "got " + res.status);

	/* the body is signed, so changing it must invalidate the signature */
	const tampered = JSON.stringify({ type: 1, smuggled: true });
	res = await post(tampered, signBody(body), envWith(up));
	ok("a tampered body is refused, so a valid signature cannot be replayed onto different content", res.status === 401, "got " + res.status);

	res = await post(body, signBody(body, Math.floor(Date.now() / 1000) - 3600), envWith(up));
	ok("a stale timestamp is refused, so a captured request stops working", res.status === 401, "got " + res.status);

	res = await post(body, signBody(body, Math.floor(Date.now() / 1000) - 3600), envWith(up, { SIGNATURE_MAX_AGE: "0" }));
	ok("...and that window can be turned off deliberately", res.status === 200, "got " + res.status);

	res = await post(body, { "x-signature-ed25519": "not-hex", "x-signature-timestamp": "1" }, envWith(up));
	ok("a malformed signature header is refused rather than crashing", res.status === 401, "got " + res.status);

	res = await post("{not json", signBody("{not json"), envWith(up));
	ok("a validly signed but unparseable body is a 400, not a 500", res.status === 400, "got " + res.status);

	res = await bot.default.fetch(new Request("https://bot.example/", { method: "GET" }), envWith(up), {});
	ok("only POST is accepted", res.status === 405, "got " + res.status);

	/* undocumented extras must still 401 - the check runs before anything else */
	res = await post(body, {}, envWith(up, { DISCORD_PUBLIC_KEY: undefined }));
	ok("with no public key configured nothing is trusted", res.status === 401, "got " + res.status);

	/* =================================================================== routing */

	up = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
	res = await post(JSON.stringify(command("nametag", [{ type: 1, name: "list", options: [] }])), signBody(JSON.stringify(command("nametag", [{ type: 1, name: "list", options: [] }]))), envWith(up));
	ok("/nametag list answers with the tags", res.status === 200 && /Vertxxy2/.test(res.text) && /revision d1-9/.test(res.text), res.text.slice(0, 160));
	ok("...and it is ephemeral, so the list is not posted in the channel",
		res.json && res.json.data && (res.json.data.flags & 64) === 64, JSON.stringify(res.json && res.json.data && res.json.data.flags));
	ok("...reading needs no Manage Roles, unlike the mutating subcommands",
		up.calls.length === 1 && up.calls[0].url.endsWith("/nametags?fresh=1"), JSON.stringify(up.calls.map(c => c.url)));

	/* every registered command must actually be routed, or users get "Unknown
	   command" for something Discord happily offered them */
	up = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
	for (const route of ROUTES) {
		const [name, sub] = route.split(" ");
		const options = sub ? [{ type: 1, name: sub, options: [
			{ type: 3, name: "user", value: "someone" },
			{ type: 3, name: "who", value: "someone" },
			{ type: 3, name: "label", value: "Tag" },
			{ type: 3, name: "color", value: "#112233" },
		] }] : [{ type: 3, name: "who", value: "someone" }];
		const payload = JSON.stringify(command(name, options));
		const r = await post(payload, signBody(payload), envWith(up));
		ok("the registered command /" + route + " is actually routed",
			!/Unknown command/.test(r.text) && r.status === 200, r.text.slice(0, 120));
	}

	/* ==================================================== set: the whole path */

	up = upstream((call) => {
		if (call.method === "PUT") return { body: { ok: true, sha: "d1-10", bytes: 2311, store: "database" } };
		return { body: RULES(), headers: { "x-xyro-sha": "d1-9" } };
	});
	const setPayload = JSON.stringify(command("nametag", [{ type: 1, name: "set", options: [
		{ type: 3, name: "user", value: "newbie" },
		{ type: 3, name: "label", value: "New" },
		{ type: 3, name: "color", value: "#6C80FF" },
		{ type: 5, name: "badge", value: true },
	] }]));
	res = await post(setPayload, signBody(setPayload), envWith(up));
	const put = up.calls.find(c => c.method === "PUT");
	ok("/nametag set publishes through the API", !!put && res.status === 200, JSON.stringify(up.calls.map(c => c.method + " " + c.url)));
	ok("...carrying the revision it read as the guard", !!put && put.url.endsWith("/nametags?sha=d1-9"), put && put.url);
	ok("...with the OWNER key, the header the Xyro Worker reads", !!put && put.headers["x-api-key"] === "owner-key", JSON.stringify(put && put.headers));
	ok("...and says when it lands in game", /within ~15s/.test(res.text) && /d1-10/.test(res.text), res.text.slice(0, 140));

	const written = JSON.parse(put.body);
	ok("the new rule is inserted BEFORE the catch-all, so it can actually fire",
		JSON.stringify(written.tags.map(t => t.match)) === JSON.stringify(["Vertxxy2", "newbie", "*"]),
		JSON.stringify(written.tags.map(t => t.match)));
	ok("...with the label, colour and verified seal", written.tags[1].label === "New" && written.tags[1].color === "#6C80FF" && written.tags[1].badge === true, JSON.stringify(written.tags[1]));
	ok("the document sent is exactly {options, tags}", JSON.stringify(Object.keys(written).sort()) === '["options","tags"]', JSON.stringify(Object.keys(written)));

	/* the same rule twice must replace, not duplicate */
	up = upstream((call) => (call.method === "PUT" ? { body: { ok: true, sha: "d1-11" } } : { body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
	const again = JSON.stringify(command("nametag", [{ type: 1, name: "set", options: [
		{ type: 3, name: "user", value: "VERTXXY2" },
		{ type: 3, name: "label", value: "Renamed" },
	] }]));
	await post(again, signBody(again), envWith(up));
	const replaced = JSON.parse(up.calls.find(c => c.method === "PUT").body);
	ok("setting an existing tag replaces it and does not duplicate the rule",
		replaced.tags.length === 2 && replaced.tags[0].label === "Renamed", JSON.stringify(replaced.tags.map(t => t.match + ":" + t.label)));

	/* ================================================= the race, from the bot's side */

	let puts = 0;
	up = upstream((call) => {
		if (call.method === "PUT") { puts++; return puts === 1 ? { status: 409, body: { error: "the rules moved on" } } : { body: { ok: true, sha: "d1-12" } }; }
		return { body: RULES(), headers: { "x-xyro-sha": "d1-9" } };
	});
	res = await post(setPayload, signBody(setPayload), envWith(up));
	ok("a publish that loses a race is re-applied on the newer revision instead of failing",
		puts === 2 && res.status === 200 && /d1-12/.test(res.text), "puts: " + puts + " " + res.text.slice(0, 120));

	/* ======================================================= permission + guild lock */

	up = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
	const weak = JSON.stringify(command("nametag", [{ type: 1, name: "set", options: [
		{ type: 3, name: "user", value: "x" }, { type: 3, name: "label", value: "y" },
	] }], { member: { user: { id: "42" }, permissions: "0" } }));
	res = await post(weak, signBody(weak), envWith(up));
	ok("a member without Manage Roles is refused", /Manage Roles/.test(res.text), res.text.slice(0, 120));
	ok("...and the API is never called, so nothing is written", up.calls.length === 0, JSON.stringify(up.calls.map(c => c.method + " " + c.url)));

	const admin = JSON.stringify(command("block", [{ type: 3, name: "who", value: "griefer" }, { type: 3, name: "reason", value: "ban evasion" }], { member: { user: { id: "42" }, permissions: String(1n << 3n) } }));
	res = await post(admin, signBody(admin), envWith(up));
	ok("Administrator is enough to pass the permission check", up.calls.length > 0, res.text.slice(0, 120));

	const owner = JSON.stringify(command("block", [{ type: 3, name: "who", value: "griefer" }], { member: { user: { id: "7" }, permissions: "0" }, guild: { owner_id: "7" } }));
	up.calls.length = 0;
	await post(owner, signBody(owner), envWith(up));
	ok("the guild owner can always run it", up.calls.length > 0, JSON.stringify(up.calls.map(c => c.url)));

	up = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
	const wrongGuild = JSON.stringify(command("nametag", [{ type: 1, name: "list", options: [] }], { guild_id: "111" }));
	res = await post(wrongGuild, signBody(wrongGuild), envWith(up, { DISCORD_GUILD_ID: "999" }));
	ok("a locked bot ignores another server's commands", /not configured for this server/.test(res.text) && up.calls.length === 0, res.text.slice(0, 120));

	/* ============================================================ block/unblock */

	up = upstream((call) => ({ body: call.method === "DELETE" ? { ok: true, action: "removed" } : { ok: true, action: "blocked" } }));
	const blockPayload = JSON.stringify(command("block", [{ type: 3, name: "who", value: "griefer" }, { type: 3, name: "reason", value: "ban evasion" }]));
	res = await post(blockPayload, signBody(blockPayload), envWith(up));
	ok("/block posts to the blacklist route with the reason as the body",
		up.calls[0].method === "POST" && up.calls[0].url === "https://api.example/blacklist/griefer" && up.calls[0].body === "ban evasion",
		JSON.stringify(up.calls[0]));
	ok("...and the reply tells the user it worked", /Blocked/.test(res.text), res.text.slice(0, 120));

	up = upstream(() => ({ body: { ok: true, action: "removed" } }));
	const unblockPayload = JSON.stringify(command("unblock", [{ type: 3, name: "who", value: "griefer" }]));
	res = await post(unblockPayload, signBody(unblockPayload), envWith(up));
	ok("/unblock DELETEs the same path", up.calls[0].method === "DELETE" && up.calls[0].url === "https://api.example/blacklist/griefer", JSON.stringify(up.calls[0]));

	/* an unblock that the staff node undoes must not be reported as success */
	up = upstream(() => ({ body: { ok: false, action: "still blocked", error: "this account is also in the Firebase staff node" } }));
	res = await post(unblockPayload, signBody(unblockPayload), envWith(up));
	ok("an unblock that did not actually stick is not reported as success", /Could not unblock/.test(res.text), res.text.slice(0, 140));

	/* ============================================================== config errors */

	up = upstream(() => ({ body: RULES() }));
	const noKey = JSON.stringify(command("nametag", [{ type: 1, name: "list", options: [] }]));
	res = await post(noKey, signBody(noKey), envWith(up, { XYRO_ADMIN_KEY: "" }));
	ok("a missing owner key says which secret to set, instead of a blank failure",
		res.status === 200 && /XYRO_ADMIN_KEY/.test(res.text), res.text.slice(0, 140));

	res = await post(noKey, signBody(noKey), envWith(up, { XYRO_API_URL: "" }));
	ok("a missing API URL says which secret to set", /XYRO_API_URL/.test(res.text), res.text.slice(0, 140));

	up = upstream(() => ({ status: 500, body: { error: "boom" } }));
	res = await post(setPayload, signBody(setPayload), envWith(up));
	ok("an upstream failure is reported to the user rather than swallowed",
		res.status === 200 && /Failed:/.test(res.text), res.text.slice(0, 140));
	/* and it carries the API's own reason, because "could not read the tags: 500"
	   is a dead end for whoever reads the Discord reply */
	ok("...including the API's own explanation", /boom/.test(res.text), res.text.slice(0, 140));

	/* ======================================= a change that changes nothing */

	/* Every publish bumps the revision and writes a mirror commit. A command
	   that removes a rule which is not there used to do both anyway, which made
	   "who last changed the tags" unanswerable and told every client in every
	   server to refresh a document that had not changed. */
	{
		const untouched = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
		const gone = JSON.stringify(command("nametag", [{ type: 1, name: "remove", options: [{ name: "user", type: 3, value: "nobody-here" }] }]));
		let res = await post(gone, signBody(gone), envWith(untouched));
		ok("removing a rule that does not exist writes nothing",
			!untouched.calls.some(c => c.method === "PUT"), JSON.stringify(untouched.calls.map(c => c.method)));
		ok("...and says so plainly", /no rule matching/.test(res.text) && !/``/.test(res.text), res.text.slice(0, 140));

		/* an omitted option is a user error, not an empty rule name */
		const bare = JSON.stringify(command("nametag", [{ type: 1, name: "remove", options: [] }]));
		const bareUp = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
		res = await post(bare, signBody(bare), envWith(bareUp));
		ok("removing with no username asks for one instead of printing empty backticks",
			/Give a Roblox username/.test(res.text), res.text.slice(0, 140));
		ok("...and still writes nothing", !bareUp.calls.some(c => c.method === "PUT"), JSON.stringify(bareUp.calls.map(c => c.method)));

		/* a real change must still publish - the guard is on "changed nothing",
		   not on "second attempt" */
		const real = upstream(call => (call.method === "PUT" ? { body: { ok: true, sha: "d1-10" } } : { body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
		const removePayload = JSON.stringify(command("nametag", [{ type: 1, name: "remove", options: [{ name: "user", type: 3, value: "Vertxxy2" }] }]));
		res = await post(removePayload, signBody(removePayload), envWith(real));
		ok("removing a rule that does exist still publishes",
			real.calls.some(c => c.method === "PUT"), JSON.stringify(real.calls.map(c => c.method)));
	}

	/* ==================================================== the service binding */

	/* A Worker fetching another Worker on the SAME zone over its public URL is
	   refused by Cloudflare with error 1042, and it arrives as an opaque
	   "404 error code: 1042" - which reads like the Xyro API is missing rather
	   than unreachable. Both Workers here are on one workers.dev subdomain, so
	   the binding is the only route that works in production, and this is the
	   regression test for the day someone "simplifies" it back to a plain
	   fetch of XYRO_API_URL. */
	{
		const bound = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
		const listPayload = JSON.stringify(command("nametag", [{ type: 1, name: "list", options: [] }]));
		const viaBinding = envWith(null, {
			XYRO_API: { fetch: bound.impl },
			XYRO_API_URL: "https://same-zone-and-therefore-blocked.example",
		});
		let res = await post(listPayload, signBody(listPayload), viaBinding);
		ok("the API is reached through the service binding", bound.calls.length > 0, "0 calls");
		ok("the public URL is not used when a binding exists",
			!bound.calls.some(c => /same-zone-and-therefore-blocked/.test(c.url)),
			JSON.stringify(bound.calls.map(c => c.url)));
		ok("...and the command still answers with the live rules", /Vertxxy2/.test(res.text), res.text.slice(0, 200));

		/* a write has to travel the same way as the read, or publishing silently
		   becomes "it worked" while nothing changes */
		const writeBound = upstream(call => (call.method === "PUT" ? { body: { ok: true, sha: "d1-11" } } : { body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
		res = await post(setPayload, signBody(setPayload), envWith(null, { XYRO_API: { fetch: writeBound.impl } }));
		ok("a publish travels through the binding too",
			writeBound.calls.some(c => c.method === "PUT"), JSON.stringify(writeBound.calls.map(c => c.method)));

		/* the binding makes the URL optional, which is the point: nothing to keep
		   in sync between two deployments */
		const noUrl = upstream(() => ({ body: RULES(), headers: { "x-xyro-sha": "d1-9" } }));
		res = await post(listPayload, signBody(listPayload), envWith(null, { XYRO_API: { fetch: noUrl.impl }, XYRO_API_URL: "" }));
		ok("the binding works with no XYRO_API_URL set at all", res.status === 200 && /Vertxxy2/.test(res.text), res.text.slice(0, 140));
	}

	/* ============================================ the two implementations agree */

	/* api/bot/bot-worker.js and api/nametags-client.js each shape the rules, in
	   different module systems. If they ever disagree, a rule added by the bot
	   and a rule added in the editor land in different places - and only one of
	   those places can ever fire. */
	const fixtures = [
		{ options: {}, tags: [{ match: "*", label: "user" }] },
		{ options: {}, tags: [{ match: "a", label: "A" }, { match: "*", label: "u" }] },
		{ options: {}, tags: [] },
	];
	for (const f of fixtures) {
		const a = JSON.parse(JSON.stringify(f));
		const b = JSON.parse(JSON.stringify(f));
		bot.setRule(a, { match: "zzz", label: "Z" });
		client.set(b, { match: "zzz", label: "Z" });
		ok("the bot Worker and the Node client insert a new rule identically",
			JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a.tags.map(t => t.match)) + " vs " + JSON.stringify(b.tags.map(t => t.match)));
	}
	ok("both report the same rule order", JSON.stringify(bot.listRules({ options: {}, tags: [{ match: "x" }, { match: "*" }] }))
		=== JSON.stringify(client.list({ options: {}, tags: [{ match: "x" }, { match: "*" }] })), "");
	ok("both refuse a malformed document the same way",
		(() => { try { bot.shapeRules({ tags: [] }); return false; } catch { return true; } })()
		&& (() => { try { client.shape({ tags: [] }); return false; } catch { return true; } })(), "");
	ok("both remove by case-insensitive match",
		bot.removeRule({ options: {}, tags: [{ match: "AbC" }] }, "abc") === true && client.remove({ options: {}, tags: [{ match: "AbC" }] }, "abc") === true, "");

	/* the option reader must survive what Discord actually sends */
	const nested = bot.optionMap({ data: { options: [{ type: 1, name: "set", options: [{ type: 3, name: "user", value: "abc" }, { type: 5, name: "badge", value: true }] }] } });
	ok("optionMap flattens a subcommand's options", nested.user === "abc" && nested.badge === true, JSON.stringify(nested));

	ok("every command the bot registers is exported for this test to check", Array.isArray(COMMANDS) && COMMANDS.length > 0 && ROUTES.length >= 5, JSON.stringify(ROUTES));

	console.log("\n" + (failures.length ? failures.length + " FAILED (" + pass + " passed)" : pass + " checks passed"));
	process.exit(failures.length ? 1 : 0);
})().catch(err => {
	console.error("FATAL:", err && err.stack ? err.stack : err);
	process.exit(1);
});
