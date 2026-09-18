// test_live_api.js - check a DEPLOYED Xyro API with real requests.
//
//   node Tools/test_live_api.js                     # against api.json's url
//   node Tools/test_live_api.js https://host        # against any deployment
//
// api/test.js proves the Worker's logic against a mocked database and repo.
// This proves the thing that is actually on the internet: that the deploy
// carries the current code, that /nametags really returns the file rather than
// a cache's memory of it, that every piece of tag artwork matches the repo byte
// for byte, and that the routes which must refuse something still do.
//
// It is read-only. The one thing it cannot check by itself is publishing: that
// needs the owner key, which is not in this repo. When GH_TOKEN is not set on
// the Worker the script says so and treats it as a known gap rather than a
// failure, because "publishing is switched off" is a legitimate state.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const md5 = b => crypto.createHash("md5").update(Buffer.from(b)).digest("hex");

let pass = 0, skip = 0, fail = 0;
const ok = (name, cond, extra) => {
	if (cond) { pass++; console.log("OK   " + name); return true; }
	fail++;
	console.log("FAIL " + name + (extra ? " -> " + extra : ""));
	return false;
};
const note = msg => { skip++; console.log("SKIP " + msg); };
const group = name => console.log("\n== " + name + " ==");

const timeIt = async fn => { const t = Date.now(); const r = await fn(); return { r, ms: Date.now() - t }; };

(async () => {
	const arg = process.argv[2];
	let base = arg;
	let key = "";
	if (!base) {
		const apiJson = JSON.parse(fs.readFileSync(path.join(ROOT, "api.json"), "utf8"));
		base = String((apiJson.api || apiJson).url || "").trim().replace(/\/+$/, "");
		key = String((apiJson.api || apiJson).key || "");
	}
	ok("there is an API url to test", !!base, "api.json has no url");
	if (!base) process.exit(1);
	ok("the url is https", base.startsWith("https://"), base);
	console.log("     testing " + base + (key ? " (client key from api.json)" : " (no key)"));

	const repoFile = async name => {
		const res = await fetch("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/" + name + "?t=" + Date.now());
		if (!res.ok) throw new Error("repo " + name + " -> " + res.status);
		return Buffer.from(await res.arrayBuffer());
	};

	/* ------------------------------------------------------ deploy is current */
	group("the deploy carries the current code");
	const health = await (await fetch(base + "/health")).json();
	const workerSrc = fs.readFileSync(path.join(ROOT, "api", "worker.js"), "utf8");
	const repoWindow = Number((workerSrc.match(/const PRESENCE_WINDOW = (\d+)/) || [])[1] || 0);
	ok("/health answers as JSON", !!health && health.ok === true, JSON.stringify(health).slice(0, 80));
	ok("the nametag routes are deployed (not an older build)", !!health.nametags, JSON.stringify(Object.keys(health)));
	ok("the presence window matches the repo's (" + repoWindow + "s)", health.presence_window === repoWindow,
		"worker says " + health.presence_window);
	ok("database is configured", /configured/.test(health.database || ""), health.database);
	ok("reads need the key", health.reads === "key required", health.reads);
	console.log("     read source: " + (health.nametags && health.nametags.read_source));
	console.log("     publish:     " + (health.nametags && health.nametags.publish));
	console.log("     database:    " + health.database_auth);

	const ghToken = /github api/.test((health.nametags && health.nametags.read_source) || "");
	const canPublish = /PUT \/nametags/.test((health.nametags && health.nametags.publish) || "");

	/* -------------------------------------------------- the rules, as bytes */
	group("the tag rules");
	const want = await repoFile("nametags.json");
	const got = await fetch(base + "/nametags");
	const gotText = await got.text();
	ok("GET /nametags is 200 JSON", got.status === 200 && /application\/json/.test(got.headers.get("content-type") || ""),
		got.status + " " + got.headers.get("content-type"));
	ok("it is byte-identical to nametags.json in the repo", md5(gotText) === md5(want),
		md5(gotText) + " vs " + md5(want));
	ok("it is the {options, tags[]} shape", (() => {
		try {
			const j = JSON.parse(gotText);
			return !!j.options && Array.isArray(j.tags) && j.tags.length > 0;
		} catch { return false; }
	})());
	ok("it is edge-cached (30s)", /max-age=30/.test(got.headers.get("cache-control") || ""), got.headers.get("cache-control"));

	const fresh = await fetch(base + "/nametags?fresh=1");
	ok("?fresh=1 returns the same rules, uncacheably", fresh.status === 200 && (await fresh.text()) === gotText && fresh.headers.get("cache-control") === "no-store",
		fresh.status + " " + fresh.headers.get("cache-control"));
	ok("the sha header is exposed to browsers", /x-xyro-sha/.test(fresh.headers.get("access-control-expose-headers") || ""),
		fresh.headers.get("access-control-expose-headers"));
	if (ghToken) {
		ok("a repo-token read carries the blob sha (safe publishing)", !!fresh.headers.get("x-xyro-sha"));
	} else {
		ok("with no repo token there is no sha, as designed", !fresh.headers.get("x-xyro-sha"));
	}

	for (const alias of ["/nametags.json", "/config"]) {
		const res = await fetch(base + alias);
		ok(alias + " is the same bytes", res.status === 200 && (await res.text()) === gotText, res.status);
	}

	/* --------------------------------------------------------- the artwork */
	group("the tag artwork");
	const mediaDir = path.join(ROOT, "media");
	const files = fs.readdirSync(mediaDir).filter(f => /\.(png|jpe?g|gif)$/i.test(f));
	let mediaOk = 0, mediaBad = [];
	for (const file of files) {
		const res = await fetch(base + "/media/" + file);
		const live = Buffer.from(await res.arrayBuffer());
		const expectType = /\.jpe?g$/i.test(file) ? "image/jpeg" : /\.gif$/i.test(file) ? "image/gif" : "image/png";
		const typeOk = res.headers.get("content-type") === expectType;
		if (res.status === 200 && typeOk && md5(live) === md5(fs.readFileSync(path.join(mediaDir, file)))) mediaOk++;
		else mediaBad.push(file + " (" + res.status + " " + res.headers.get("content-type") + ", " + live.length + "b)");
	}
	ok("every media file in the repo is served byte-for-byte (" + mediaOk + "/" + files.length + ")", mediaBad.length === 0, mediaBad.join(", "));
	ok("media is long-cached (300s)", /max-age=300/.test((await fetch(base + "/media/verified_seal_blue.png")).headers.get("cache-control") || ""));
	ok("?fresh=1 overrides the media cache", (await fetch(base + "/media/verified_seal_blue.png?fresh=1")).headers.get("cache-control") === "no-store");

	/* ------------------------------------------- refusals that must hold --- */
	group("the routes that must say no");
	ok("a path a client key must not reach", /"error"/.test(await (await fetch(base + "/media/worker.js")).text()));
	ok("an unknown media extension is 404", (await fetch(base + "/media/worker.js")).status === 404);
	ok("a missing media file is 404, not 502", (await fetch(base + "/media/nope_seal.png")).status === 404);
	ok("a traversal attempt never reaches a repo path", (await fetch(base + "/media/..%2Fworker.js")).status === 404);
	ok("a nested media path is not a route", (await fetch(base + "/media/foo/bar.png")).status === 404);
	const putNoKey = await fetch(base + "/nametags", { method: "PUT", body: '{"options":{},"tags":[]}' });
	ok("PUT /nametags without a key is refused (nothing is written)", putNoKey.status === 403 || putNoKey.status === 503, "got " + putNoKey.status);
	ok("POST /nametags/check without a key is refused", (await fetch(base + "/nametags/check", { method: "POST" })).status === 403);
	ok("the client key alone cannot publish", (await fetch(base + "/nametags", {
		method: "PUT",
		headers: { "x-api-key": key, "content-type": "application/json" },
		body: '{"options":{},"tags":[]}',
	})).status === 403);

	/* ---------------------------------------- what a real client actually does */
	group("the URLs clients build");
	const gate = await fetch(base + "/staff/gate.json" + (key ? "?key=" + key : ""));
	ok("the gate answers the script's poll", gate.status === 200, "got " + gate.status);
	const loader = await fetch(base + "/loader");
	const loaderSrc = await loader.text();
	ok("/loader needs no key (it is the hand-out line)", loader.status === 200, "got " + loader.status);
	ok("...and rewrites its API line to this origin", loaderSrc.includes('local API = "' + base + '"'));
	ok("...and fills in the client key", !key || loaderSrc.includes('local KEY = "' + key + '"'));
	const clientURLs = {
		"rules (periodic poll)": base + "/nametags" + (key ? "?key=" + key : ""),
		"rules (manual refresh)": base + "/nametags?fresh=1" + (key ? "&key=" + key : ""),
		"ranked seal": base + "/media/seal_partner.png?v=14" + (key ? "&key=" + key : ""),
		"verified badge": base + "/media/verified_seal_blue.png?v=14" + (key ? "&key=" + key : ""),
	};
	for (const [name, url] of Object.entries(clientURLs)) {
		const res = await fetch(url);
		ok("the game's " + name + " URL works verbatim", res.status === 200, res.status + " " + url);
	}

	/* ------------------------------------------------------- the edge cache */
	group("the edge cache");
	/* Interleaved A/B with a median, not one sample each. A single sample is
	   dominated by whatever the connection happened to cost - the first request
	   after an idle period pays DNS and TLS setup and can read 300ms while every
	   later one is 40ms, which says nothing about the cache. Alternating also
	   cancels any drift in the network between the two halves. */
	await fetch(base + "/nametags");
	const warm = [], cold = [];
	for (let i = 0; i < 5; i++) {
		warm.push((await timeIt(() => fetch(base + "/nametags"))).ms);
		cold.push((await timeIt(() => fetch(base + "/nametags?fresh=1"))).ms);
	}
	const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
	const warmMed = median(warm), coldMed = median(cold);
	console.log("     cached   /nametags         " + warm.join(" ") + " ms (median " + warmMed + ")");
	console.log("     upstream /nametags?fresh=1 " + cold.join(" ") + " ms (median " + coldMed + ")");
	ok("a repeat read is served from the edge cache, not refetched upstream",
		warmMed <= coldMed || warmMed < 120, "medians " + warmMed + "ms vs " + coldMed + "ms");

	/* --------------------------------------------------------- publishing */
	group("publishing through the API");
	ok("the check route refuses a missing key", (await fetch(base + "/nametags/check", { method: "POST" })).status === 403);
	if (canPublish) ok("a repo-token read carries the sha the editor posts back", !!fresh.headers.get("x-xyro-sha"));

	/* The owner key is never printed, and never leaves except over TLS to this
	   one route. gate.js already reads this file, so a deployment check may too -
	   and the two requests below are chosen so they CANNOT write: /nametags/check
	   changes nothing, and the publish body is the rules that are already live,
	   so even an impossible success would be a commit that changes nothing. */
	const keyFile = path.join(ROOT, "api", ".xyro-admin-key");
	const ownerKey = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "";
	if (!ownerKey) {
		note("no api/.xyro-admin-key found, so the owner-key routes were not exercised");
		console.log("     put your key there (it is gitignored) to check it, or run:");
		console.log("     curl.exe -X POST " + base + "/nametags/check -H \"x-api-key: YOUR_OWNER_KEY\"");
	} else {
		const check = await fetch(base + "/nametags/check", { method: "POST", headers: { "x-api-key": ownerKey } });
		const checkBody = await check.json().catch(() => ({}));
		ok("the owner key in api/.xyro-admin-key is accepted", check.status !== 403, "got " + check.status);
		if (check.status === 200 && checkBody.ok === true) {
			ok("the Worker can reach the repo with its GH_TOKEN", !!checkBody.sha, JSON.stringify(checkBody));
			console.log("     file sha: " + String(checkBody.sha).slice(0, 7) + " · the editor's Save & test will pass");
		} else if (check.status === 503) {
			note("the key is right, but the Worker still needs GH_TOKEN: " + (checkBody.error || ""));
			console.log("     set it with:  npx --yes wrangler@latest secret put GH_TOKEN");
			console.log("     (fine-grained token, Contents: Read and write on this repo - then re-run this)");
		} else {
			console.log("     check route said: " + check.status + " " + (checkBody.error || JSON.stringify(checkBody)));
		}

		/* the write guard, proved without a write */
		const put = await fetch(base + "/nametags", {
			method: "PUT",
			headers: { "x-api-key": ownerKey, "content-type": "application/json" },
			body: gotText, // exactly what is already published: a no-op even if it landed
		});
		if (!canPublish) {
			ok("a publish is refused for the missing token BEFORE it writes anything", put.status === 503, "got " + put.status + " (expected 503, which happens before any GitHub call)");
		} else {
			ok("a no-op publish of the live rules is accepted", put.status === 200, "got " + put.status + " " + (await put.text()).slice(0, 120));
			const after = await (await fetch(base + "/nametags?fresh=1")).text();
			ok("...and the file still holds exactly the same rules", after === gotText, "the no-op publish changed the file");
		}
	}

	console.log("\n" + pass + " passed, " + fail + " failed" + (skip ? ", " + skip + " skipped/incomplete" : ""));
	process.exit(fail ? 1 : 0);
})().catch(err => {
	console.log("\nFAILED to complete: " + (err && err.message ? err.message : err));
	process.exit(1);
});
