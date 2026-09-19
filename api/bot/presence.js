// presence.js - give the Cloudflare-hosted bot a green dot.
//
//   node api/bot/presence.js
//
// WHY THIS EXISTS. The bot itself runs on a Cloudflare Worker, and a Worker only
// wakes when Discord POSTs an interaction to it. Between commands there is no
// process, no socket, and therefore no presence - so the bot reads as OFFLINE in
// your member list even though every slash command works perfectly. That is not
// a misconfiguration, and nothing you set in the Developer Portal changes it.
//
// Presence lives on the GATEWAY, which is a persistent WebSocket Discord refuses
// to accept from Cloudflare's egress addresses (see bot-worker.js). So the dot
// needs a host that stays alive: this script. It does nothing except connect,
// identify, and heartbeat. It never touches your tag rules - the Worker still
// answers every command, because setting an Interactions Endpoint URL routes
// interactions there regardless of whether a gateway session exists.
//
//   Discord ──interactions──▶ xyro-bot Worker ──▶ tags API     (commands)
//   Discord ──gateway───────▶ this script                     (presence only)
//
// Both use the same bot token and both can run at once. Do NOT deploy this to
// Workers: it is precisely the thing that cannot run there.
//
// Token: DISCORD_TOKEN in the environment, or a file named .discord-token next
// to this script (gitignored). Never commit it - a token can post as your bot.
//
// Status: DISCORD_STATUS (online|idle|dnd|invisible) and DISCORD_ACTIVITY /
// DISCORD_ACTIVITY_TYPE (playing|streaming|listening|watching|competing|custom)
// optionally set what the member list shows next to the name.
//
// No dependencies: Node 22+ ships a global WebSocket. Verified on Node 24.
"use strict";

const fs = require("fs");
const path = require("path");

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

/* Gateway opcodes we care about. */
const OP = {
	DISPATCH: 0,
	HEARTBEAT: 1,
	IDENTIFY: 2,
	RECONNECT: 7,
	INVALID_SESSION: 9,
	HELLO: 10,
	HEARTBEAT_ACK: 11,
};

/* GUILDS only. This is the one intent that is NOT privileged - it is enough to
   hold a valid session without asking for message content or member presence,
   neither of which this script needs to display a status. Asking for more would
   mean the bot silently fails to connect unless you also tick the switches in
   the Developer Portal, which is a needless way to break it. */
const INTENTS = 1;

/* Close codes worth naming. 4004 is the only one where retrying is pointless:
   a bad token stays bad, so retrying just hides the real message in a log. */
const FATAL_CLOSE = {
	4004: "authentication failed - DISCORD_TOKEN is wrong or was reset",
	4010: "invalid shard",
	4011: "sharding required",
	4012: "invalid API version",
	4013: "invalid intents",
	4014: "disallowed intents - enable them in the Developer Portal",
};

const STATUSES = ["online", "idle", "dnd", "invisible"];
const ACTIVITY_TYPES = {
	playing: 0,
	streaming: 1,
	listening: 2,
	watching: 3,
	custom: 4,
	competing: 5,
};

function readTokenFile(file) {
	try {
		const raw = fs.readFileSync(file, "utf8");
		/* copied tokens arrive with a trailing newline and sometimes quotes */
		return raw.trim().replace(/^["']|["']$/g, "");
	} catch (err) {
		return "";
	}
}

/* Resolve the run configuration, and say exactly what is missing rather than
   failing later with a 4004 that looks like a wrong token. */
function resolveConfig(env = process.env, opts = {}) {
	const file = opts.tokenFile || path.join(__dirname, ".discord-token");
	const token = String(env.DISCORD_TOKEN || "").trim() || readTokenFile(file);

	const rawStatus = String(env.DISCORD_STATUS || "online").trim().toLowerCase();
	const status = STATUSES.indexOf(rawStatus) === -1 ? "online" : rawStatus;

	const typeName = String(env.DISCORD_ACTIVITY_TYPE || "playing").trim().toLowerCase();
	const activityType = Object.prototype.hasOwnProperty.call(ACTIVITY_TYPES, typeName)
		? ACTIVITY_TYPES[typeName]
		: ACTIVITY_TYPES.playing;

	const activity = String(env.DISCORD_ACTIVITY || "").trim();

	return {
		token,
		status,
		activity,
		activityType,
		gatewayUrl: opts.gatewayUrl || GATEWAY_URL,
		tokenFile: file,
	};
}

/* A custom status is a different shape from a normal activity: it carries the
   words in `state`, and Discord renders `name` as the activity name. Sending the
   normal shape for type 4 shows the text in the wrong place. */
function buildActivities(cfg) {
	if (!cfg.activity) return [];
	if (cfg.activityType === ACTIVITY_TYPES.custom) {
		return [{ name: "Custom Status", type: ACTIVITY_TYPES.custom, state: cfg.activity }];
	}
	return [{ name: cfg.activity, type: cfg.activityType }];
}

function buildPresence(cfg) {
	return {
		since: null,
		afk: false,
		status: cfg.status,
		activities: buildActivities(cfg),
	};
}

/* Presence is sent inside IDENTIFY, which is what makes the bot appear online on
   the very first frame instead of after a separate op 3 update. */
function buildIdentify(cfg) {
	return {
		op: OP.IDENTIFY,
		d: {
			token: cfg.token,
			intents: INTENTS,
			properties: {
				os: process.platform,
				browser: "xyro-presence",
				device: "xyro-presence",
			},
			presence: buildPresence(cfg),
		},
	};
}

function buildHeartbeat(seq) {
	return { op: OP.HEARTBEAT, d: seq === null ? null : seq };
}

/* Exponential with a ceiling, plus jitter: Discord closes a session that
   reconnects on a fixed interval, and a fleet of bots doing that hammers it. */
function backoffDelay(attempt, random = Math.random) {
	const base = Math.min(30000, 1000 * Math.pow(2, attempt));
	const jitter = Math.floor(base * 0.3 * random());
	return base - Math.floor(base * 0.15) + jitter;
}

/* The keeper. Timers, the socket and the clock are injectable so the tests can
   drive the whole protocol deterministically instead of waiting on wall time. */
function createKeeper(opts = {}) {
	const cfg = opts.config || resolveConfig(opts.env || process.env, opts);
	const log = opts.log || function (line) { console.log(line); };
	const makeSocket = opts.socketFactory || function (url) { return new WebSocket(url); };
	const setTimer = opts.setTimeout || setTimeout;
	const clearTimer = opts.clearTimeout || clearTimeout;
	const random = opts.random || Math.random;

	let socket = null;
	let heartbeatTimer = null;
	let reconnectTimer = null;
	let seq = null;
	let awaitingAck = false;
	let attempt = 0;
	let stopped = false;

	function send(payload) {
		if (!socket || socket.readyState !== 1) return false;
		try {
			socket.send(JSON.stringify(payload));
			return true;
		} catch (err) {
			return false;
		}
	}

	function stopHeartbeat() {
		if (heartbeatTimer !== null) {
			clearTimer(heartbeatTimer);
			heartbeatTimer = null;
		}
		awaitingAck = false;
	}

	/* A missed ACK means the socket is a zombie: it is open and silent, so
	   nothing else would ever notice. Reconnecting is the only recovery. */
	function startHeartbeat(intervalMs) {
		stopHeartbeat();
		const interval = Math.max(1000, Number(intervalMs) || 41250);
		const beat = () => {
			if (stopped) return;
			if (awaitingAck) {
				log("no heartbeat ACK from Discord - the session is dead, reconnecting");
				return reconnect();
			}
			awaitingAck = true;
			send(buildHeartbeat(seq));
			heartbeatTimer = setTimer(beat, interval);
		};
		/* Start partway into the window, as Discord asks, so a restart cannot
		   land every client's first beat on the same tick. */
		heartbeatTimer = setTimer(beat, Math.floor(interval * (0.5 + 0.4 * random())));
	}

	function teardown() {
		stopHeartbeat();
		if (socket) {
			const dead = socket;
			socket = null;
			/* dropping the handlers first stops the close we are about to cause
			   from being mistaken for a dropped connection and retried twice */
			dead.onopen = null;
			dead.onmessage = null;
			dead.onclose = null;
			dead.onerror = null;
			try {
				dead.close();
			} catch (err) {
				/* already closed */
			}
		}
	}

	function reconnect(delay) {
		if (stopped) return;
		teardown();
		const wait = typeof delay === "number" ? delay : backoffDelay(attempt, random);
		attempt += 1;
		log("reconnecting in " + Math.round(wait / 1000) + "s (attempt " + attempt + ")");
		if (reconnectTimer !== null) clearTimer(reconnectTimer);
		reconnectTimer = setTimer(connect, wait);
	}

	function onMessage(raw) {
		let msg;
		try {
			msg = JSON.parse(typeof raw === "string" ? raw : String(raw));
		} catch (err) {
			return;
		}
		if (typeof msg.s === "number") seq = msg.s;

		switch (msg.op) {
			case OP.HELLO:
				startHeartbeat(msg.d && msg.d.heartbeat_interval);
				send(buildIdentify(cfg));
				break;
			case OP.HEARTBEAT:
				/* Discord asked for one now - answer off-schedule. */
				send(buildHeartbeat(seq));
				break;
			case OP.HEARTBEAT_ACK:
				awaitingAck = false;
				attempt = 0;
				break;
			case OP.RECONNECT:
				log("Discord asked us to reconnect");
				reconnect();
				break;
			case OP.INVALID_SESSION:
				/* Not resuming: a fresh IDENTIFY re-sends presence, which is the
				   only thing this script is here for. */
				log("session invalidated - identifying again");
				reconnect(1000 + Math.floor(4000 * random()));
				break;
			case OP.DISPATCH:
				if (msg.t === "READY") {
					attempt = 0;
					const user = (msg.d && msg.d.user) || {};
					log("online as " + (user.username || "the bot") + " (" + cfg.status + ")" +
						(cfg.activity ? " - " + cfg.activity : ""));
				}
				break;
			default:
				break;
		}
	}

	function connect() {
		if (stopped) return;
		reconnectTimer = null;
		seq = null;
		let next;
		try {
			next = makeSocket(cfg.gatewayUrl);
		} catch (err) {
			log("could not open the gateway socket: " + (err && err.message ? err.message : err));
			return reconnect();
		}
		socket = next;

		next.onopen = function () {
			log("gateway connected, waiting for HELLO");
		};
		next.onmessage = function (event) {
			onMessage(event && event.data !== undefined ? event.data : event);
		};
		next.onerror = function (err) {
			log("gateway socket error: " + ((err && err.message) || "unknown"));
		};
		next.onclose = function (event) {
			if (stopped) return;
			const code = event && event.code;
			if (code && FATAL_CLOSE[code]) {
				stopped = true;
				log("cannot stay online: " + FATAL_CLOSE[code]);
				if (opts.onFatal) opts.onFatal(code, FATAL_CLOSE[code]);
				return;
			}
			log("gateway closed" + (code ? " (" + code + ")" : "") + " - reconnecting");
			reconnect();
		};
	}

	function stop() {
		stopped = true;
		if (reconnectTimer !== null) {
			clearTimer(reconnectTimer);
			reconnectTimer = null;
		}
		teardown();
	}

	return { connect, stop, config: cfg, isStopped: function () { return stopped; } };
}

function main() {
	const cfg = resolveConfig();
	if (!cfg.token) {
		console.log("No bot token found. Set DISCORD_TOKEN, or write the token to:");
		console.log("  " + cfg.tokenFile);
		console.log("");
		console.log("The token is in the Developer Portal -> Bot -> Reset Token (it is");
		console.log("the same one register-commands.js uses).");
		process.exit(1);
	}

	const keeper = createKeeper({ config: cfg });
	keeper.connect();
	console.log("keeping the bot " + cfg.status + " - press Ctrl+C to stop");

	/* Ctrl+C otherwise leaves the gateway to time the session out. */
	process.on("SIGINT", function () {
		console.log("closing the gateway session");
		keeper.stop();
		process.exit(0);
	});
}

module.exports = {
	OP,
	INTENTS,
	STATUSES,
	ACTIVITY_TYPES,
	FATAL_CLOSE,
	GATEWAY_URL,
	resolveConfig,
	buildIdentify,
	buildPresence,
	buildActivities,
	buildHeartbeat,
	backoffDelay,
	createKeeper,
};

if (require.main === module) main();
