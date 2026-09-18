#!/usr/bin/env node
/**
 * gate.js - control the Xyro kill switch from your own machine.
 *
 *   node api/gate.js status                      what the gate looks like now
 *   node api/gate.js off "down for 10 minutes"   switch the script off for everyone
 *   node api/gate.js off "be right back" --for 10m   ...and re-open by itself
 *   node api/gate.js extend 20m                  push an existing window out
 *   node api/gate.js on                          let everyone back in
 *   node api/gate.js warn "restarting soon"      announcement; nobody is stopped
 *   node api/gate.js clear-warn                  remove the announcement
 *
 * Flags:  --for <10m|1h30m|45s|2>   --by <name>   --json   --no-color
 * Key:    XYRO_ADMIN_KEY from the environment, else api/.xyro-admin-key,
 *         else ~/.xyro-admin-key. This is the OWNER key - never the one that
 *         ships in api.json, and never committed (it is in .gitignore).
 * URL:    api.url from api.json, so this always talks to the deployed Worker.
 *
 * `off --for` is the one worth remembering: the switch re-opens on its own when
 * the window passes, so a forgotten maintenance window cannot lock everybody
 * out for a day. Nothing else needs to run for that - every client and the
 * loader read the same `until` and stop treating the gate as closed.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const API_JSON = path.join(__dirname, "..", "api.json");
const KEY_FILES = [path.join(__dirname, ".xyro-admin-key"), path.join(os.homedir(), ".xyro-admin-key")];
const UNITS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** "10m" -> 600, "1h30m" -> 5400, "45s" -> 45, "2" -> 120 (a bare number is
 *  minutes, which is what people mean). Anything unparseable returns 0. */
function parseDuration(text) {
	if (text == null || text === "") return 0;
	const s = String(text).trim().toLowerCase();
	if (/^\d+$/.test(s)) return Number(s) * 60;
	const re = /(\d+)\s*([wdhms])/g;
	let total = 0;
	let matched = false;
	let m;
	while ((m = re.exec(s)) !== null) {
		matched = true;
		total += Number(m[1]) * UNITS[m[2]];
	}
	return matched ? total : 0;
}

/** 570 -> "9m 30s" */
function humanize(sec) {
	let s = Math.max(0, Math.floor(Number(sec) || 0));
	if (s < 60) return s + "s";
	const out = [];
	const d = Math.floor(s / 86400);
	if (d) out.push(d + "d");
	const h = Math.floor((s % 86400) / 3600);
	if (h) out.push(h + "h");
	const m = Math.floor((s % 3600) / 60);
	if (m) out.push(m + "m");
	const r = s % 60;
	if (r && !d) out.push(r + "s");
	return out.join(" ");
}

function color(code, text) {
	if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
	return "\u001b[" + code + "m" + text + "\u001b[0m";
}
const green = t => color("32", t);
const amber = t => color("33", t);
const red = t => color("31", t);
const dim = t => color("2", t);

function readApiUrl() {
	try {
		const j = JSON.parse(fs.readFileSync(API_JSON, "utf8"));
		const api = j && j.api;
		return api && typeof api.url === "string" ? api.url.trim().replace(/\/+$/, "") : "";
	} catch {
		return "";
	}
}

function readClientKey() {
	try {
		const j = JSON.parse(fs.readFileSync(API_JSON, "utf8"));
		return String((j && j.api && j.api.key) || "").trim();
	} catch {
		return "";
	}
}

function readAdminKey() {
	const env = String(process.env.XYRO_ADMIN_KEY || "").trim();
	if (env) return env;
	for (const file of KEY_FILES) {
		try {
			const value = fs.readFileSync(file, "utf8").trim();
			if (value) return value;
		} catch {
			/* not there - try the next place */
		}
	}
	return "";
}

async function api(base, route, opts = {}) {
	const headers = {};
	if (opts.key) headers["x-api-key"] = opts.key;
	if (opts.by) headers["x-xyro-by"] = opts.by;
	let body;
	if (opts.body !== undefined) {
		headers["content-type"] = "application/json";
		body = JSON.stringify(opts.body);
	}
	let res;
	try {
		res = await fetch(base + route, { method: opts.method || "GET", headers, body });
	} catch (err) {
		throw new Error("could not reach " + base + " (" + (err && err.message ? err.message : err) + ")");
	}
	const text = await res.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* not JSON - keep the raw text for the error message */
	}
	return { status: res.status, json, text };
}

function report(gate) {
	const state = gate.enabled ? green("OPEN") : amber("DISABLED");
	console.log("  gate: " + state + dim("  (" + (gate.source || "database") + ")"));
	console.log("  script: " + (gate.enabled ? "everyone can run it" : "loaders refuse and running clients shut down within ~20s"));
	if (gate.message) console.log("  message: " + gate.message);
	if (gate.warn) console.log("  warning: " + gate.warn);
	if (gate.reopens_in > 0) console.log("  re-opens: " + humanize(gate.reopens_in) + " from now");
	if (!gate.enabled && !(gate.reopens_in > 0)) console.log("  re-opens: " + amber("never") + dim(" - no window set, run `on` when you are done"));
	if (gate.auto_reopened) console.log("  note: " + dim("the window you set has passed, so the switch closed itself"));
	if (gate.updated) console.log("  set: " + dim(new Date(gate.updated * 1000).toLocaleString() + (gate.by ? " by " + gate.by : "")));
}

function fail(msg) {
	console.error(red("x") + " " + msg);
	return 1;
}

const HELP = `
Xyro kill switch

  node api/gate.js status                        show the current gate
  node api/gate.js off "<message>" [--for 10m]    switch the script off
  node api/gate.js extend 20m                     push an open window further out
  node api/gate.js on                             let everyone back in
  node api/gate.js warn "<message>"               announcement, nobody is stopped
  node api/gate.js clear-warn                     remove the announcement

flags   --for <10m|1h30m|45s|2>   --by <name>   --json   --no-color
key     XYRO_ADMIN_KEY, or api/.xyro-admin-key, or ~/.xyro-admin-key
url     api.url from api.json (currently: ${readApiUrl() || "not set"})

while the gate is off: the loader refuses before downloading, clients already
running tear themselves down within ~20s, and /script answers 403.
`;

async function main(argv) {
	const flags = {};
	const args = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--for" || a === "--by") flags[a.slice(2)] = argv[++i];
		else if (a.startsWith("--for=")) flags.for = a.slice(6);
		else if (a.startsWith("--by=")) flags.by = a.slice(5);
		else if (a === "--json") flags.json = true;
		else if (a === "--no-color") process.env.NO_COLOR = "1";
		else if (a === "-h" || a === "--help") {
			console.log(HELP);
			return 0;
		} else args.push(a);
	}

	const cmd = (args.shift() || "status").toLowerCase();
	const url = readApiUrl();
	if (!url) return fail("api.json has no api.url - deploy the Worker first (api/README.md)");
	const admin = readAdminKey();
	const by = flags.by || "cli";

	if (cmd === "status") {
		const key = admin || readClientKey();
		if (!key) return fail("no key found: set XYRO_ADMIN_KEY, or write it to api/.xyro-admin-key");
		const res = await api(url, "/gate", { key });
		if (res.status !== 200) return fail("the API said " + res.status + ": " + ((res.json && res.json.error) || res.text.slice(0, 120)));
		if (flags.json) {
			console.log(JSON.stringify(res.json, null, 2));
			return 0;
		}
		console.log(url);
		report(res.json);
		return 0;
	}

	if (!admin) {
		return fail("changing the gate needs the OWNER key.\n  Set XYRO_ADMIN_KEY, or save it in api/.xyro-admin-key (gitignored).\n  It is the secret you set with: npx wrangler secret put XYRO_ADMIN_KEY");
	}

	let patch;
	if (cmd === "off") {
		const message = args.join(" ").trim();
		patch = { enabled: false };
		if (message) patch.message = message;
		if (flags.for) {
			const secs = parseDuration(flags.for);
			if (!secs) return fail('--for "' + flags.for + '" is not a duration - try 10m, 1h30m, 45s or 2');
			patch.until = Math.floor(Date.now() / 1000) + secs;
		}
	} else if (cmd === "on") {
		patch = { enabled: true };
	} else if (cmd === "warn") {
		patch = { warn: args.join(" ").trim() };
	} else if (cmd === "clear-warn") {
		patch = { warn: "" };
	} else if (cmd === "extend") {
		const secs = parseDuration(args[0]);
		if (!secs) return fail("extend needs a duration, e.g. `extend 20m`");
		patch = { until: Math.floor(Date.now() / 1000) + secs };
	} else {
		console.log(HELP);
		return fail('unknown command "' + cmd + '"');
	}

	const res = await api(url, "/gate", { method: "POST", key: admin, by, body: patch });
	if (res.status !== 200) {
		const why = (res.json && res.json.error) || res.text.slice(0, 160) || "no body";
		if (res.status === 403) return fail("the admin key was refused (" + why + ")\n  Check XYRO_ADMIN_KEY matches the Worker's secret.");
		if (res.status === 503) return fail("the Worker has no XYRO_ADMIN_KEY set yet: " + why);
		return fail("the API said " + res.status + ": " + why);
	}

	if (flags.json) {
		console.log(JSON.stringify(res.json, null, 2));
		return 0;
	}
	console.log(dim(url));
	const gate = (res.json && res.json.gate) || {};
	report(gate);
	// a Worker deployed before `until` existed answers without those fields, so
	// `--for` would look accepted while the switch stayed closed forever. Say so
	// instead of letting a maintenance window become permanent.
	if (patch.until && !("until" in gate)) {
		console.log("\n" + amber("warning:") + " this Worker is running an older build that ignores --for.");
		console.log(dim("  Deploy the current api/worker.js (npx wrangler deploy) before relying on the window."));
	}
	if (cmd === "off") {
		console.log("\n" + amber("Everyone is switched off.") + " Loaders refuse before downloading; clients in game shut down within ~20 seconds.");
		if (!patch.until) console.log(dim("No window set - remember to run: node api/gate.js on"));
	}
	if (cmd === "on") console.log("\n" + green("Everyone is back on.") + " The next launch works immediately.");
	if (cmd === "warn") console.log("\n" + dim("Announcement shown once per client; the script keeps running."));
	return 0;
}

module.exports = { parseDuration, humanize };

if (require.main === module) {
	main(process.argv.slice(2))
		.then(code => process.exit(code))
		.catch(err => {
			console.error(red("x") + " " + (err && err.message ? err.message : String(err)));
			process.exit(1);
		});
}
