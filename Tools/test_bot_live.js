// test_bot_live.js - the DEPLOYED Discord bot endpoint, checked with real requests.
//
//   node Tools/test_bot_live.js                  # checks that always run
//   node Tools/test_bot_live.js --selftest       # also signs real interactions
//
// Why two modes. The signature check is the whole security of the endpoint, and
// the only way to know it accepts genuine requests - rather than rejecting
// everything, which also "works" against a forged one - is to sign something
// with the matching private key. Discord keeps that private key, so there is no
// way to sign as Discord. --selftest therefore generates its own pair, installs
// the public half as DISCORD_PUBLIC_KEY, drives the signed path, and tells you
// to put your REAL public key back afterwards.
//
// This replaces the manual "save the URL in the Developer Portal and see" step
// for diagnosing a deployment, and the 1042 note in the same place: a Worker
// fetching another Worker on its own zone is refused, so the bot reaches the
// tags through a service binding.
const path = require("path");
const { spawnSync } = require("child_process");
const { generateKeyPairSync, sign, createPrivateKey } = require("crypto");

const ROOT = path.join(__dirname, "..");
const BOT_DIR = path.join(ROOT, "api", "bot");
const URL_UNDER_TEST = process.env.XYRO_BOT_URL || "https://xyro-bot.xyroapi.workers.dev";
const SELFTEST = process.argv.includes("--selftest");

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
	if (cond) {
		pass++;
		console.log("  ok   " + name);
	} else {
		failures.push(name);
		console.log("  FAIL " + name + (extra ? "   " + extra : ""));
	}
}

const post = (body, headers) =>
	fetch(URL_UNDER_TEST, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

(async () => {
	console.log("=== the deployed bot: " + URL_UNDER_TEST + "\n");

	/* ------------------------------------------------- what Discord will do */
	/* The Developer Portal saves the Interactions Endpoint URL only if this
	   answers a signed PING. Without the real public key installed the honest
	   answer is 401, so the check that matters is "401, not 404 or 500": it
	   proves the Worker is deployed and the verifier is in front of everything. */
	console.log("the endpoint is live and guarded:");
	const unsigned = await post("{}");
	ok("an unsigned POST is refused (401, not a 404 - so it IS deployed)", unsigned.status === 401, "status " + unsigned.status);

	const get = await fetch(URL_UNDER_TEST);
	ok("a GET is 405 rather than a confusing 404", get.status === 405, "status " + get.status);

	const unsignedPing = await post(JSON.stringify({ type: 1 }));
	ok("an unsigned PING is refused, so nobody can fake a validation", unsignedPing.status === 401, "status " + unsignedPing.status);

	/* a correct-shaped but wrong signature must not slip through */
	const forged = await post(JSON.stringify({ type: 1 }), {
		"x-signature-ed25519": "ab".repeat(64),
		"x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
	});
	ok("a forged signature is refused", forged.status === 401, "status " + forged.status);

	if (!SELFTEST) {
		console.log("\nthe signed path needs --selftest (it swaps in a throwaway public key):");
		console.log("  node Tools/test_bot_live.js --selftest");
		console.log("\n  then put your real key back:");
		console.log("    cd api/bot && npx wrangler secret put DISCORD_PUBLIC_KEY");
		console.log("\n" + pass + " passed, " + failures.length + " failed");
		process.exit(failures.length ? 1 : 0);
	}

	/* ------------------------------------------------------------ self-test */
	console.log("\n--selftest: installing a throwaway public key");
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const pubHex = Buffer.from(publicKey.export({ type: "spki", format: "der" }).subarray(-32)).toString("hex");
	const priv = createPrivateKey({ key: privateKey.export({ type: "pkcs8", format: "der" }), format: "der", type: "pkcs8" });

	/* one command string with shell, not an args array: on Windows npx is a .cmd
	   and needs a shell, and passing both is what DEP0190 warns about */
	const put = spawnSync("npx --yes wrangler@latest secret put DISCORD_PUBLIC_KEY", {
		cwd: BOT_DIR,
		input: pubHex,
		encoding: "utf8",
		shell: true,
	});
	if (put.status !== 0) {
		console.log("  could not install the key - run it by hand:");
		console.log("    cd api/bot && npx wrangler secret put DISCORD_PUBLIC_KEY");
		console.log((put.stderr || "").slice(0, 300));
		process.exit(1);
	}
	console.log("  installed " + pubHex.slice(0, 16) + "...\n");

	/* a secret change is picked up on the next request, but a Worker that has
	   not been hit yet may still hold the old one */
	const signed = async (payload, at) => {
		const timestamp = at == null ? Math.floor(Date.now() / 1000) : at;
		const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
		const sig = sign(null, Buffer.from(String(timestamp) + raw), priv).toString("hex");
		const res = await post(raw, { "x-signature-ed25519": sig, "x-signature-timestamp": String(timestamp) });
		const text = await res.text();
		let json = null;
		try {
			json = JSON.parse(text);
		} catch {
			/* keep the text */
		}
		return { status: res.status, json, text };
	};

	/* A secret change is not instant: the first request after installing it can
	   still be answered by a warm isolate holding the PREVIOUS value. Without
	   this loop the very next check reports a deployment failure that resolves
	   itself a second later - and worse, every rejection check below "passes"
	   while everything is being refused, which is the blind spot this whole file
	   exists to avoid. */
	console.log("the signed path, the way Discord sends it:");
	let ping = null;
	for (let i = 0; i < 12; i++) {
		ping = await signed({ type: 1 });
		if (ping.status === 200) break;
		await new Promise(r => setTimeout(r, 500));
	}
	ok("a genuinely signed PING is answered with PONG", ping.status === 200 && ping.json && ping.json.type === 1, ping.text.slice(0, 120));
	/* if the warm-up never took, everything after this is meaningless */
	if (ping.status !== 200) {
		console.log("\n  the throwaway key never took effect - is DISCORD_PUBLIC_KEY installed?");
		process.exit(1);
	}

	const tampered = await signed({ type: 1, evil: true });
	/* sign the ORIGINAL, send the modified one */
	const raw = JSON.stringify({ type: 1 });
	const ts = Math.floor(Date.now() / 1000);
	const res = await post(JSON.stringify({ type: 1, evil: true }), {
		"x-signature-ed25519": sign(null, Buffer.from(String(ts) + raw), priv).toString("hex"),
		"x-signature-timestamp": String(ts),
	});
	ok("a body modified after signing is refused", res.status === 401, "status " + res.status);

	const stale = await signed({ type: 1 }, Math.floor(Date.now() / 1000) - 3600);
	ok("a replayed old timestamp is refused", stale.status === 401, "status " + stale.status);

	const command = {
		id: "1",
		type: 2,
		application_id: "1",
		token: "t",
		guild_id: "999",
		member: { user: { id: "42" }, permissions: "8" },
		data: { name: "nametag", options: [{ type: 1, name: "list", options: [] }] },
	};
	const list = await signed(command);
	ok("`/nametag list` answers inline, not deferred", list.status === 200 && !!list.json && list.json.type === 4, list.text.slice(0, 120));
	/* this is the check that the SERVICE BINDING works: over the public URL the
	   same call comes back as "404 error code: 1042" */
	ok("...and reaches the live tags through the service binding",
		/Could not|revision|[a-z]+`\s*->/.test(list.text) && !/1042/.test(list.text), list.text.slice(0, 240).replace(/\n/g, " / "));
	console.log("\n  reply: " + (list.json && list.json.data && list.json.data.content || list.text).slice(0, 240).replace(/\n/g, "\n         "));

	console.log("\n!! PUT YOUR REAL PUBLIC KEY BACK NOW:");
	console.log("     cd api/bot && npx wrangler secret put DISCORD_PUBLIC_KEY");
	console.log("     (Developer Portal -> General Information -> Public Key)");
	console.log("   Until you do, Discord's own validation will be refused - it signs with a");
	console.log("   key this Worker no longer holds.\n");
	console.log(pass + " passed, " + failures.length + " failed");
	process.exit(failures.length ? 1 : 0);
})();
