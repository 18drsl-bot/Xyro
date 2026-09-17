# Xyro

Roblox script hub. Public repo, no auth needed.

## Load

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/refs/heads/main/xyro.lua"))()
```

Executes the **latest commit every time** — no reinstalling after updates. Config and
media load through the jsDelivr CDN (purged instantly on every editor publish), with
the GitHub API and raw GitHub as fallbacks, so published changes land in seconds.

**Fallback loader** (3x retry + always-fresh GitHub API source + truncation checks,
for flaky executors):

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/loadstring.lua"))()
```

The console prints `Loaded Version: vX.Y.Z` — that is what's live in version.txt, so
you can always confirm you're on the latest build.

## Commands

| Command | Aliases | What it does |
|---|---|---|
| `!nametags` | `!tags` | Toggle the nametag badges |
| `!nametagsfetch` | `!tagsfetch` | Re-fetch nametags.json from this repo immediately |
| `!staffrefresh` | | Re-fetch the staff list from Firebase (new staff, no script update needed) |

## Nametags

Badges float above the heads of people **running Xyro** (presence-gated — players not
running the script never get tagged). The current design: avatar icon + display name
row + `@username` row on a dark rounded pill, visible through walls, with live health
and distance, click-to-teleport, and the game's default overhead name hidden.

`nametags.json` controls everything. It re-fetches automatically every 60 seconds, or
run `!nametagsfetch` for instant reload.

```json
{
	"options": {
		"size": 15,
		"userSize": 10,
		"height": 48,
		"imageSize": 36,
		"maxDistance": 0,
		"showDistance": true,
		"showHealth": true,
		"showBox": true,
		"onlyScriptUsers": true,
		"pillColor": "#0C0C10",
		"pillTransparency": 0.12,
		"font": "GothamBlack",
		"textColor": "#FFFFFF",
		"userColor": "#8B92A5",
		"clickTeleport": true
	},
	"tags": [
		{ "match": "x9ksa", "label": "OWNER", "color": "#FFD700", "size": 16, "badge": true }
	]
}
```

**Rule keys:** `match` (start of username/display name, case-insensitive; `*` = all) ·
`label` (text above the head) · `color` (border color) · `image` (icon: https URL,
asset id, or rbxassetid) · `bg` / `bgTransparency` (pill background) · `size` (name
size) · `userSize` · `font` (GothamBlack, Bangers, Arcade, ...) · `textColor` ·
`userColor` · `badge` (the **real Roblox verified seal** — blue scalloped disc with a
white check — after the name; every rule with `badge: true` gets it, staff or not)
· `rank` (recolor the seal for this rule: `founder` / `hr` / `support` /
`trial` / `purple`) · `height` · `imageSize`. First matching rule wins —
put exact names above the `*` catch-all.

**Options:** `size` · `userSize` · `height` · `imageSize` · `maxDistance` (studs, 0 =
always) · `showDistance` · `showHealth` · `showBox` (pill background on/off) ·
`onlyScriptUsers` (tags require presence — set false to tag everyone matching) ·
`pillColor` / `pillTransparency` (defaults for rules without `bg`) · `font` ·
`textColor` · `userColor` · `clickTeleport` (click a pill to teleport to that player — works both full-size and collapsed) · `collapseFar` / `collapseDistance` / `collapsedIcon` (far tags shrink to just the avatar icon, which still click-teleports; hovering the mouse near the icon expands the full pill while it's on screen) ·`staffOnly` (when true, only Xyro staff get tags at all — non-staff see nothing, cache nothing) · `refreshSeconds` (how often
the script re-checks for published changes, 10–300, default 15)

Tags render as plain billboard UI, so **any executor works** — no Drawing API needed.
Icons support PNG/JPG/GIF by URL, asset id, or base64 `data:` URI - **GIFs fully animate** (decoded frame-by-frame in script, since Roblox only shows a GIF's first frame). Rules also take `bgImage` (URL or data URI) to fill the pill background; the editor's **Choose file** buttons upload images to `media/` in this repo (base64-embeds them without a token).

The editor is **GitHub-hosted only**: https://vertxxy-1.github.io/Xyro/ — nothing runs on
your PC; publish straight from that page.

## Firebase staff list

By default the admin list is hardcoded in `xyro.lua` (`ADMIN_IDS`). To manage
staff from a browser instead — add/remove who's staff without touching the
script — point the script at a free Firebase Realtime Database:

1. Create a project at https://console.firebase.google.com/ → **Build → Realtime
   Database → Create Database**. Copy the URL (looks like
   `https://xyro-abc123-default-rtdb.firebaseio.com`).
2. Publish these **rules** (public read, no writes):

   ```json
   { "rules": { "staff": { ".read": true, ".write": false } } }
   ```

3. Add a `staff` node with your staff, by Roblox user ID and/or exact username:

   ```json
   { "staff": { "admins": ["8579040069", "stellarpAlladium"] } }
   ```

4. In `xyro.lua`, set the two lines marked `EDIT THESE TWO LINES`:
   `H.FIREBASE_URL = "https://xyro-abc123-default-rtdb.firebaseio.com"`.
   `H.FIREBASE_AUTH` stays empty with the rules above.

The script reads the list once at launch (and on `!staffrefresh`) and merges it
with the hardcoded IDs. Staff get the Debug tab + the verified nametag badge.
Full guide with every accepted layout: **[FIREBASE.md](FIREBASE.md)**.

---

## Controlling nametags from a Discord bot

The tag editor is just a browser calling the GitHub Contents API — a Discord bot
can do the exact same thing (Create / View / Edit / Delete / Transfer / Search
rules, upload images) with a fine-grained GitHub token. Every publish lands
in-game within seconds. Full copy-paste guide: **[DISCORD-BOT.md](DISCORD-BOT.md)**.
