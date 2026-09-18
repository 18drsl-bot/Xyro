# Managing nametags from a Discord bot

Your Discord bot can edit `nametags.json` in this repo **exactly like the web
editor does** — the editor is just a browser calling the GitHub Contents API.
Same endpoints, same token permissions. The game reads the file from raw GitHub
(fresh within seconds), so no CDN purge is required for updates to land.

## Setup (once)

1. GitHub → **Settings → Developer settings → Fine-grained personal access
   tokens → Generate new token**.
   - **Repository access:** Only select repositories → `vertxxy-1/Xyro`
   - **Permissions → Repository permissions → Contents: Read and write**
   - (Metadata: Read-only is granted automatically.)
2. Put the token in an env var (never hardcode it): `XYRO_TOKEN=github_pat_...`
3. Config is one object:

```js
const REPO = "vertxxy-1/Xyro";
const PATH = "nametags.json";
const API  = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
const CDN  = `https://cdn.jsdelivr.net/gh/${REPO}@main/${PATH}`;
const headers = {
	Authorization: `Bearer ${process.env.XYRO_TOKEN}`,
	"Content-Type": "application/json",
	Accept: "application/vnd.github+json",
	"User-Agent": "your-discord-bot", // api.github.com requires a UA
};
```

## Read the live config

```js
async function readConfig() {
	const res = await fetch(API + "?t=" + Date.now(), { headers });
	if (!res.ok) throw new Error("read failed: " + res.status);
	const meta = await res.json();
	return {
		sha: meta.sha, // REQUIRED for writes
		json: JSON.parse(Buffer.from(meta.content, "base64").toString("utf8")),
	};
}
```

## Write it back (create / edit / delete rules)

Everything — Create, View, Edit, Delete, Transfer, Search — is just
"read, mutate the `tags` array, write back". Always use the **fresh `sha`**
from your read (stale sha = 409; refetch and retry once), and serialize with
tabs to match what the editor publishes:

```js
async function writeConfig(sha, json, message) {
	const body = JSON.stringify({ options: json.options, tags: json.tags }, null, "\t") + "\n";
	const res = await fetch(API, {
		method: "PUT",
		headers,
		body: JSON.stringify({
			message, // shows up as a normal commit on vertxxy-1/Xyro
			content: Buffer.from(body, "utf8").toString("base64"),
			sha,
		}),
	});
	if (!res.ok) throw new Error("write failed: " + res.status + " " + (await res.text()));
	// kick the game's CDN so players get it in seconds, not minutes
	await fetch("https://purge.jsdelivr.net/gh/" + REPO + "@main/" + PATH).catch(() => {});
}

// example: Edit = recolor an existing rule
const { sha, json } = await readConfig();
const rule = json.tags.find(t => (t.match || "").toLowerCase() === "noixctl");
if (!rule) return msg.reply("no rule for that user");
rule.color = "#5E0EAD";
await writeConfig(sha, json, `bot: recolor ${rule.match} via /nametag edit`);
```

**Race warning:** if your staff edit in the web editor at the same moment, the
last write wins. Read → mutate → write immediately; don't cache `sha` across
commands.

## Images (icons / backgrounds)

1. **Upload to the repo** (same as the editor's *Choose file* buttons):
   `PUT /repos/vertxxy-1/Xyro/contents/media/<name>` with the same token —
   the editor stores files as `media/<sha1-of-content>.<ext>`. Then set
   `image` / `bgImage` to
   `https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/media/<name>`.
2. **No upload budget?** Set `image` / `bgImage` to a `data:image/png;base64,...`
   URI — the game embeds it with zero repo changes (bigger `nametags.json`).
3. GIFs animate in-game either way.

## Staff list via Firebase (optional)

The script also merges staff from a Firebase Realtime Database so you can add
/remove staff from the Firebase console with zero repo commits. Setup is two
repo files: `staff` data in Firebase (public read, no writes — see
FIREBASE.md) plus a `firebase.json` in the repo root:

```json
{ "firebase": { "url": "https://your-db-default-rtdb.firebaseio.com" } }
```

Your bot can write that file with the same `readConfig`/`writeConfig` helpers
above (pointed at `firebase.json` instead of `nametags.json`) — a `PUT` to
`/contents/firebase.json`.

## Blacklist from the bot (optional)

The blacklist lives in the same Firebase `staff` node, and unlike the script
your bot **can** write it — it runs on your machine with a database secret, so
the rules below stay closed to the public while the bot keeps full access:

```json
{
  "rules": {
    "staff": {
      ".read": true,
      ".write": false,
      "blacklist": { ".write": "auth != null" }
    },
    "cmd":  { ".read": true, ".write": true },
    "here": { ".read": true, ".write": true }
  }
}
```

```js
// /block 1234567890 ban evasion       -> add (value = the reason shown on screen)
// /unblock 1234567890                 -> remove
const DB = "https://your-db-default-rtdb.firebaseio.com";
const SECRET = process.env.XYRO_DB_SECRET; // never ship this to clients
const key = who => `/staff/blacklist/${who}.json?auth=${SECRET}`;

async function blacklist(who, reason) {
	await fetch(DB + key(who), { method: "PUT", body: JSON.stringify(reason || "") });
}
async function unblacklist(who) {
	await fetch(DB + key(who), { method: "DELETE" });
}
```

Players pick the change up on their next launch, or immediately with
`!staffrefresh`; in game `!blocked` prints the list. (If you have the Xyro API
deployed, `POST /blacklist/<who>` with the owner key does the same thing without
handing your bot a database secret — see the kill switch section below.) A blacklisted account gets
no UI, tags, presence or command transport, and every other client stops
drawing their tag — see **FIREBASE.md → 3c. Blacklist**.

## Kill switch from the bot (optional)

With the Xyro API deployed (`api/README.md`), stopping and resuming everyone is
two lines — and the owner key never touches a client. The Worker needs one
database credential for this to work at all (`FB_SERVICE_ACCOUNT`, `api/README.md`
section 4), because the database refuses anonymous writes to `staff`; without it
the call comes back `403` naming the fix.

```js
const API = "https://xyro-api.you.workers.dev";
const ADMIN = process.env.XYRO_ADMIN_KEY; // server-side only, never in api.json

// /shutdown reason:down for maintenance  -> stop every loader AND every running client
// /resume                                -> let them back in
async function setGate(enabled, message) {
	await fetch(API + "/gate/" + (enabled ? "on" : "off"), {
		method: "POST",
		headers: { "x-api-key": ADMIN, "x-xyro-by": "discord" },
		body: message || "",
	});
}

// /announce reason:restarting in 10 minutes -> a notice they see, and keep playing
async function announce(text) {
	await fetch(API + "/gate", {
		method: "POST",
		headers: { "x-api-key": ADMIN, "content-type": "application/json", "x-xyro-by": "discord" },
		body: JSON.stringify({ warn: text }),
	});
}
```

The same idea works for the blacklist: `POST /blacklist/<id or name>` with the
body set to the reason, and `DELETE /blacklist/<id or name>` to unblock — no
database secret and no rules to edit. `GET /gate` and `GET /blacklist` read the
current state back for your command replies.

## Verified badge

Just set `"badge": true` on a rule — players get the **real Roblox verified
seal** (blue scalloped checkmark). Optional `"rank"` recolors it: `founder`
(silver) / `developer` (red) / `hr` (white) / `support` (green) / `trial` (teal) /
`purple` / `partner` (dark blue).

## Testing

Set `"match": "<your exact username>"` on a test rule, publish, then in game
run `!nametagsfetch` — the console prints the reload. The script also re-fetches
on its own every 60s (or `refreshSeconds`).
