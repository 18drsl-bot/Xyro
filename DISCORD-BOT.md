# Managing nametags from a Discord bot

Your Discord bot can edit `nametags.json` in this repo **exactly like the web
editor does** — the editor is just a browser calling the GitHub Contents API.
Same endpoints, same token permissions, same instant CDN purge.

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

## Verified badge

Just set `"badge": true` on a rule — players get the **real Roblox verified
seal** (blue scalloped checkmark). Optional `"rank"` recolors it: `founder`
(silver) / `hr` (white) / `support` (green) / `trial` (teal) / `purple` /
`partner` (dark blue).

## Testing

Set `"match": "<your exact username>"` on a test rule, publish, then in game
run `!nametagsfetch` — the console prints the reload. The script also re-fetches
on its own every 60s (or `refreshSeconds`).
