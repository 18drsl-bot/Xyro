// test_presence.js - the gateway keeper that gives the Cloudflare bot a green dot.
//
//   node Tools/test_presence.js
//
// Presence is the one part of this bot that CANNOT be verified by deploying it:
// a successful connection looks identical to a broken one in every log except
// the exact one this script prints, and the failure mode is "Discord closed the
// session and the bot silently went grey again". So the protocol is driven here
// over a fake socket and a fake clock - HELLO, IDENTIFY, heartbeats, a missed
// ACK, and both classes of close - rather than left to a manual run.
const fs = require("fs");
const path = require("path");

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
const presence = require(path.join(ROOT, "api", "bot", "presence.js"));

/* ------------------------------------------------------------- the harness */

function fakeClock() {
	let now = 0;
	let nextId = 1;
	const pending = new Map();
	return {
		setTimeout(fn, ms) {
			const id = nextId++;
			pending.set(id, { fn, at: now + (Number(ms) || 0) });
			return id;
		},
		clearTimeout(id) {
			pending.delete(id);
		},
		advance(ms) {
			const target = now + ms;
			for (;;) {
				let bestId = null;
				let bestAt = Infinity;
				for (const [id, task] of pending) {
					if (task.at <= target && task.at < bestAt) {
						bestAt = task.at;
						bestId = id;
					}
				}
				if (bestId === null) break;
				const task = pending.get(bestId);
				pending.delete(bestId);
				now = task.at;
				task.fn();
			}
			now = target;
		},
		pending() {
			return pending.size;
		},
	};
}

/* A socket that records frames and lets the test play Discord's side. */
function fakeSocket(url) {
	const sock = {
		url,
		readyState: 0,
		sent: [],
		closed: false,
		onopen: null,
		onmessage: null,
		onclose: null,
		onerror: null,
	};
	sock.send = function (raw) {
		if (sock.readyState !== 1) throw new Error("send on a socket that is not open");
		sock.sent.push(JSON.parse(raw));
	};
	sock.close = function () {
		sock.closed = true;
		sock.readyState = 3;
	};
	sock.open = function () {
		sock.readyState = 1;
		if (sock.onopen) sock.onopen({});
	};
	sock.deliver = function (payload) {
		if (sock.onmessage) sock.onmessage({ data: JSON.stringify(payload) });
	};
	sock.raw = function (payload) {
		if (sock.onmessage) sock.onmessage({ data: payload });
	};
	sock.drop = function (code) {
		if (sock.onclose) sock.onclose({ code });
	};
	sock.of = function (op) {
		return sock.sent.filter((frame) => frame.op === op);
	};
	return sock;
}

function harness(env, opts) {
	const clock = fakeClock();
	const sockets = [];
	const lines = [];
	const overrides = Object.assign(
		{
			env: env || {},
			tokenFile: path.join(ROOT, "Tools", ".no-such-token-file"),
			socketFactory(url) {
				const sock = fakeSocket(url);
				sockets.push(sock);
				return sock;
			},
			setTimeout: clock.setTimeout,
			clearTimeout: clock.clearTimeout,
			random: () => 0.5,
			log(line) {
				lines.push(line);
			},
		},
		opts || {}
	);
	const keeper = presence.createKeeper(overrides);
	return {
		keeper,
		clock,
		sockets,
		lines,
		last() {
			return sockets[sockets.length - 1];
		},
		saw(text) {
			return lines.some((line) => line.indexOf(text) !== -1);
		},
	};
}

const TOKEN = "BotToken.DoNotCommit.abc123";

/* --------------------------------------------------------------- configuration */

const cfgNone = presence.resolveConfig({}, { tokenFile: path.join(ROOT, "Tools", ".nope") });
ok("no token anywhere resolves to an empty token", cfgNone.token === "", JSON.stringify(cfgNone.token));
ok("a missing token defaults the status to online", cfgNone.status === "online", cfgNone.status);

const cfgEnv = presence.resolveConfig({ DISCORD_TOKEN: "  " + TOKEN + "  " });
ok("DISCORD_TOKEN is trimmed", cfgEnv.token === TOKEN, JSON.stringify(cfgEnv.token));

const cfgBad = presence.resolveConfig({
	DISCORD_TOKEN: TOKEN,
	DISCORD_STATUS: "BUSY",
	DISCORD_ACTIVITY_TYPE: "dancing",
});
ok("an unknown status falls back to online rather than sending garbage", cfgBad.status === "online", cfgBad.status);
ok("an unknown activity type falls back to playing", cfgBad.activityType === 0, String(cfgBad.activityType));

const cfgCase = presence.resolveConfig({
	DISCORD_TOKEN: TOKEN,
	DISCORD_STATUS: "DND",
	DISCORD_ACTIVITY: "Managing tags",
	DISCORD_ACTIVITY_TYPE: "WATCHING",
});
ok("status matching is case-insensitive", cfgCase.status === "dnd", cfgCase.status);
ok("activity type matching is case-insensitive", cfgCase.activityType === 3, String(cfgCase.activityType));

/* A token file copied from Discord carries a newline, and often quotes. */
const tmpToken = path.join(ROOT, "Tools", ".tmp-presence-token");
fs.writeFileSync(tmpToken, '"' + TOKEN + '"\r\n');
const cfgFile = presence.resolveConfig({}, { tokenFile: tmpToken });
fs.unlinkSync(tmpToken);
ok("a quoted, CRLF token file resolves to the bare token", cfgFile.token === TOKEN, JSON.stringify(cfgFile.token));

/* ------------------------------------------------------------- frame shapes */

const identify = presence.buildIdentify(cfgCase);
ok("IDENTIFY uses op 2", identify.op === 2, String(identify.op));
ok("IDENTIFY carries the token", identify.d.token === TOKEN, "");
ok("IDENTIFY asks only for the non-privileged GUILDS intent", identify.d.intents === 1, String(identify.d.intents));
ok("IDENTIFY includes the required properties", !!(identify.d.properties && identify.d.properties.os && identify.d.properties.browser && identify.d.properties.device), JSON.stringify(identify.d.properties));
ok("presence rides along in IDENTIFY, so the dot is green on the first frame", identify.d.presence && identify.d.presence.status === "dnd", JSON.stringify(identify.d.presence));
ok("the activity is sent with its type", identify.d.presence.activities[0].type === 3 && identify.d.presence.activities[0].name === "Managing tags", JSON.stringify(identify.d.presence.activities));

const custom = presence.buildActivities({ activity: "tagging", activityType: presence.ACTIVITY_TYPES.custom });
ok("a custom status puts the words in `state`, where Discord renders them", custom[0].state === "tagging" && custom[0].type === 4, JSON.stringify(custom));

const noActivity = presence.buildIdentify(presence.resolveConfig({ DISCORD_TOKEN: TOKEN }));
ok("with no activity configured none is invented", noActivity.d.presence.activities.length === 0, JSON.stringify(noActivity.d.presence.activities));
ok("afk defaults false and since is null, as Discord requires", noActivity.d.presence.afk === false && noActivity.d.presence.since === null, JSON.stringify(noActivity.d.presence));

ok("a heartbeat before any dispatch carries d: null, not 0", presence.buildHeartbeat(null).d === null, JSON.stringify(presence.buildHeartbeat(null)));
ok("a heartbeat echoes the sequence number", presence.buildHeartbeat(42).d === 42, JSON.stringify(presence.buildHeartbeat(42)));

const b0 = presence.backoffDelay(0, () => 0.5);
const b1 = presence.backoffDelay(1, () => 0.5);
const b5 = presence.backoffDelay(5, () => 0.5);
const b20 = presence.backoffDelay(20, () => 0.5);
ok("backoff grows with the attempt count", b1 > b0, b0 + " -> " + b1);
ok("backoff is capped at 30s so a long outage does not become an hour", b20 <= 30000, String(b20));
ok("backoff is not a fixed interval, which Discord closes sessions for", presence.backoffDelay(3, () => 0.1) !== presence.backoffDelay(3, () => 0.9), "");

/* ------------------------------------------------------- the protocol itself */

const h = harness({ DISCORD_TOKEN: TOKEN, DISCORD_STATUS: "online", DISCORD_ACTIVITY: "Managing tags", DISCORD_ACTIVITY_TYPE: "playing" });
h.keeper.connect();
ok("connect opens exactly one socket", h.sockets.length === 1, String(h.sockets.length));
ok("the gateway URL asks for v10 JSON", h.last().url.indexOf("v=10") !== -1 && h.last().url.indexOf("encoding=json") !== -1, h.last().url);
ok("nothing is sent before HELLO", h.last().sent.length === 0, JSON.stringify(h.last().sent));

h.last().open();
ok("IDENTIFY still waits for HELLO rather than racing it", h.last().sent.length === 0, JSON.stringify(h.last().sent));

h.last().deliver({ op: 10, d: { heartbeat_interval: 1000 } });
const ids = h.last().of(2);
ok("HELLO triggers IDENTIFY", ids.length === 1, String(ids.length));
ok("IDENTIFY carries the configured presence", ids[0].d.presence.status === "online" && ids[0].d.presence.activities[0].name === "Managing tags", JSON.stringify(ids[0].d.presence));
ok("the first heartbeat is scheduled", h.clock.pending() === 1, String(h.clock.pending()));

h.last().deliver({ op: 0, t: "READY", s: 1, d: { user: { username: "xyro" } } });
ok("READY is reported to the operator", h.saw("online as xyro"), h.lines.join(" | "));

/* Advance one interval at a time and ACK between beats, the way a healthy
   session actually looks. Advancing past several intervals WITHOUT an ACK is a
   different test - that is the zombie case further down, and it must reconnect. */
h.clock.advance(1000);
ok("the first heartbeat goes out on the interval", h.last().of(1).length === 1, String(h.last().of(1).length));
h.last().deliver({ op: 11 });
h.clock.advance(1000);
h.last().deliver({ op: 11 });
h.clock.advance(1000);
h.last().deliver({ op: 11 });
const beats = h.last().of(1);
ok("heartbeats keep going while the session is healthy", beats.length === 3, String(beats.length));
ok("heartbeats echo the last sequence number", beats[0].d === 1, JSON.stringify(beats[0]));
ok("an ACKed session never reconnects", h.sockets.length === 1, String(h.sockets.length));

const beforeAsk = h.last().of(1).length;
h.last().deliver({ op: 1 });
ok("an op 1 request is answered immediately, off-schedule", h.last().of(1).length === beforeAsk + 1, String(h.last().of(1).length));
h.last().deliver({ op: 11 });

/* A socket that stays open but stops ACKing is the failure nothing else sees. */
const zombie = h.last();
const socketCountBefore = h.sockets.length;
h.clock.advance(40000);
ok("a missed ACK is detected and the session is torn down", zombie.closed, "socket still open");
ok("a missed ACK schedules a reconnect", h.sockets.length === socketCountBefore + 1, String(h.sockets.length));
ok("the dead-session reason is logged", h.saw("no heartbeat ACK"), h.lines.join(" | "));
ok("the reconnect is announced with its delay", h.saw("reconnecting in"), h.lines.join(" | "));

/* Reconnect must re-identify, or the bot comes back grey. */
h.last().open();
h.last().deliver({ op: 10, d: { heartbeat_interval: 41250 } });
ok("the reconnect identifies again", h.last().of(2).length === 1, String(h.last().of(2).length));

/* Every reconnect is SCHEDULED, not immediate - it waits out the backoff. So
   each of these triggers first, then advances the clock past the longest
   possible backoff. Asserting on sockets.length without advancing would fail
   even though the behaviour is right, which is exactly how a test ends up
   "fixed" by weakening the wrong thing. */
function reconnectAfter(env, ms) {
	env.clock.advance(ms);
}

/* op 7 from Discord means "drop this session and start again". */
h.last().open();
h.last().deliver({ op: 10, d: { heartbeat_interval: 41250 } });
const sevenVictim = h.last();
const beforeSeven = h.sockets.length;
h.last().deliver({ op: 7 });
ok("op 7 RECONNECT schedules a new session", h.clock.pending() >= 1, String(h.clock.pending()));
reconnectAfter(h, 31000);
ok("op 7 RECONNECT is honoured", h.sockets.length === beforeSeven + 1, String(h.sockets.length));
ok("the replaced socket is closed", sevenVictim.closed, "old socket left open");

/* op 9 with d:true means the session could be resumed; a fresh IDENTIFY also
   re-sends presence, which is the only thing this script wants. */
h.last().open();
h.last().deliver({ op: 10, d: { heartbeat_interval: 41250 } });
const nineVictim = h.last();
const beforeNine = h.sockets.length;
h.last().deliver({ op: 9, d: true });
reconnectAfter(h, 31000);
ok("op 9 INVALID_SESSION falls back to a fresh identify", h.sockets.length === beforeNine + 1, String(h.sockets.length));
ok("the invalidated socket is closed", nineVictim.closed, "old socket left open");

/* A dropped connection is retryable. */
h.last().open();
h.last().deliver({ op: 10, d: { heartbeat_interval: 41250 } });
const beforeDrop = h.sockets.length;
h.last().drop(1006);
reconnectAfter(h, 31000);
ok("an abnormal close is retried", h.sockets.length === beforeDrop + 1, String(h.sockets.length));
ok("the close code is logged", h.saw("(1006)"), h.lines.join(" | "));

/* A malformed frame must not kill the keeper - and the keeper must not be
   tricked into reconnecting by something that is not even a gateway frame. */
h.last().open();
h.last().deliver({ op: 10, d: { heartbeat_interval: 41250 } });
const beforeBad = h.sockets.length;
const timersBefore = h.clock.pending();
h.last().raw("this is not json");
ok("a non-JSON frame is ignored rather than thrown", h.sockets.length === beforeBad, String(h.sockets.length));
ok("a non-JSON frame leaves the session timers alone", h.clock.pending() === timersBefore && timersBefore >= 1, String(h.clock.pending()));

/* ------------------------------------------------------------- fatal errors */

const fatal = harness({ DISCORD_TOKEN: TOKEN });
fatal.keeper.connect();
fatal.last().open();
fatal.last().deliver({ op: 10, d: { heartbeat_interval: 1000 } });
const fatalSockets = fatal.sockets.length;
fatal.last().drop(4004);
ok("a bad token stops the keeper instead of retrying forever", fatal.keeper.isStopped(), "still retrying");
ok("a bad token opens no new socket", fatal.sockets.length === fatalSockets, String(fatal.sockets.length));
ok("a bad token says exactly what is wrong", fatal.saw("DISCORD_TOKEN is wrong"), fatal.lines.join(" | "));
fatal.clock.advance(120000);
ok("and it stays stopped after time passes", fatal.sockets.length === fatalSockets, String(fatal.sockets.length));

/* ---------------------------------------------------------------- shutdown */

const bye = harness({ DISCORD_TOKEN: TOKEN });
bye.keeper.connect();
bye.last().open();
bye.last().deliver({ op: 10, d: { heartbeat_interval: 1000 } });
const byeSocket = bye.last();
bye.keeper.stop();
ok("stop() closes the socket", byeSocket.closed, "socket left open");
ok("stop() clears the heartbeat and reconnect timers", bye.clock.pending() === 0, String(bye.clock.pending()));
bye.clock.advance(300000);
ok("nothing happens after stop()", bye.sockets.length === 1, String(bye.sockets.length));

/* ----------------------------------------------------------- misuse guards */

const noToken = harness({});
noToken.keeper.connect();
ok("with no token the keeper still starts rather than throwing", noToken.sockets.length === 1, String(noToken.sockets.length));

const broken = harness({ DISCORD_TOKEN: TOKEN }, {
	socketFactory() {
		throw new Error("no WebSocket in this runtime");
	},
});
broken.keeper.connect();
ok("a socket that cannot even open is treated as a retryable failure", broken.saw("could not open the gateway socket"), broken.lines.join(" | "));
ok("and a retry is scheduled for it", broken.clock.pending() >= 1, String(broken.clock.pending()));

/* ------------------------------------------------- the bot stays on the Worker */

const botToml = fs.readFileSync(path.join(ROOT, "api", "bot", "wrangler.toml"), "utf8");
ok("presence.js is not the Worker's entry point", /main\s*=\s*"bot-worker\.js"/.test(botToml), "");
ok("the bot Worker is still the only deployed entry", (botToml.match(/\bmain\s*=/g) || []).length === 1, "");

const workerSrc = fs.readFileSync(path.join(ROOT, "api", "bot", "bot-worker.js"), "utf8");
ok("the Worker still exports only a fetch handler", workerSrc.indexOf("async fetch(request, env, ctx)") !== -1, "");
ok("the Worker does not try to open a gateway (Cloudflare refuses it)", !/new WebSocket\(/.test(workerSrc), "");

const gitignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
ok("the token file is gitignored, so presence cannot commit the bot token", gitignore.indexOf(".discord-token") !== -1, "");

console.log("");
console.log(pass + " passed, " + failures.length + " failed");
if (failures.length) {
	for (const f of failures) console.log("  - " + f);
	process.exit(1);
}
