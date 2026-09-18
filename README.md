# Xyro

Roblox script hub. Public repo, no auth needed.

## Load

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/refs/heads/main/xyro.lua"))()
```

Executes the **latest commit every time** — no reinstalling after updates. Config and
media load through the jsDelivr CDN, with the GitHub API and raw GitHub as fallbacks,
so published changes land in seconds.

**Fallback loader** (3x retry + always-fresh GitHub API source + download
verification, for flaky executors):

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/loadstring.lua"))()
```

### Your own loader (served by the API, not by GitHub)

`custom-loader.lua` is a short, brandable loader you own — the same five jobs as
`loadstring.lua` (ask the kill switch, download through the API, validate, run, report),
written to be read in one sitting. Hand out this line instead of a GitHub URL:

```lua
loadstring(game:HttpGet("https://xyro-api.xyroapi.workers.dev/loader"))()
```

The Worker serves it, so the client never touches GitHub: nothing to block,
nothing to rate-limit, no CDN cache to wait on. `/loader` rewrites the file's own
`API` and `KEY` lines as it serves it, which means the hand-out line carries no
key at all — rotating `XYRO_KEY` cannot break a loader people already have — and
the gate answers `403` to it, so a shutdown stops the loader **before it is even
delivered**. Paste `custom-loader.lua` into an executor directly and it works too;
you just set those two lines by hand from `api.json`. `LOADER_FILE` in
`api/wrangler.toml` chooses which file `/loader` hands out.
The console prints `Loaded Version: vX.Y.Z` — that is what's live in version.txt, so
you can always confirm you're on the latest build.

Each download is verified three ways before it is ever executed: a size floor and
content markers, a **byte-exact length match** against the size GitHub reports for
the file (which also catches a CDN serving a stale revision), and a **compile** of
the chunk itself. A cut-off or stale copy is rejected and the next mirror is tried;
if nothing passes cleanly the best candidate still runs, with a warning saying why.

## Commands

| Command | Aliases | What it does |
|---|---|---|
| `!nametags` | `!tags` | Toggle the nametag badges |
| `!nametagsfetch` | `!tagsfetch` | Re-fetch nametags.json from this repo immediately |
| `!staffrefresh` | | Re-fetch the staff list from Firebase (new staff, no script update needed) |
| `!blocked` | `!blacklist` | List the accounts blacklisted in Firebase (staff only) |
| `!gate` | | Show whether the remote kill switch has this script enabled (staff only) |

## Nametags

Badges float above the heads of people **running Xyro** (presence-gated — players not
running the script never get tagged). The current design: avatar icon + display name
row + `@username` row on a dark rounded pill, visible through walls, with live health
and distance, click-to-teleport, and the game's default overhead name hidden.

`nametags.json` controls everything. The game reads it straight from raw GitHub (fresh
within seconds of a publish) and double-checks via the GitHub API every ~60s, so a stale
CDN can never delay your updates. It re-fetches automatically every 15 seconds, or run
`!nametagsfetch` for instant reload.

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
`trial` / `purple` / `partner`) · `height` · `imageSize`. First matching rule wins —
put exact names above the `*` catch-all.

**Options:** `size` · `userSize` · `height` · `imageSize` · `maxDistance` (studs, 0 =
always) · `showDistance` · `showHealth` · `showBox` (pill background on/off) ·
`onlyScriptUsers` (tags require presence — set false to tag everyone matching) ·
`pillColor` / `pillTransparency` (defaults for rules without `bg`) · `font` ·
`textColor` · `userColor` · `clickTeleport` (click a pill to teleport to that player — works both full-size and collapsed) · `collapseFar` / `collapseDistance` / `collapsedIcon` (icon-only mode: a tag past `collapseDistance` studs shrinks to just its icon, and zooming the camera out past that many studs from your own character collapses every tag so you see only icons. Icons still click-teleport, and hovering the mouse near one expands the full pill while it's on screen. `0` disables it entirely) ·`staffOnly` (when true, only Xyro staff get tags at all — non-staff see nothing, cache nothing) · `refreshSeconds` (how often
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

4. Add **`firebase.json`** to the repo root (no script edits needed):

   ```json
   { "firebase": { "url": "https://xyro-abc123-default-rtdb.firebaseio.com" } }
   ```

   `H.FIREBASE_AUTH` stays empty with the rules above. (Editing the two
   `EDIT THESE TWO LINES` lines in `xyro.lua` still works — the repo file
   is just the no-repush way to do it.)

The script reads the list once at launch (and on `!staffrefresh`) and merges it
with the hardcoded IDs. Staff get the Debug tab + the verified nametag badge.
Full guide with every accepted layout: **[FIREBASE.md](FIREBASE.md)**.

### Blacklist

The same `staff` node takes a **`blacklist`**:

```json
{ "staff": { "admins": ["8579040069"], "blacklist": { "1234567890": "ban evasion" } } }
```

A listed account gets no window, no staff panel, no nametag, no presence and no
command transport — the script refuses to run and shows a card with the reason.
Their tag is also suppressed on **everyone else's** client, which is the part a
blacklisted user cannot bypass by editing their own copy. Keys are user IDs or
exact usernames; the value is the reason shown on screen. Read-only for clients
on purpose (otherwise anyone could blacklist a rival), so it is managed in the
Firebase console; `!staffrefresh` picks changes up instantly, and `!blocked`
prints the current list in game.

### Optional: put it behind your own API (Cloudflare Worker)

Firebase works fine on its own, but every client then talks to the database
directly — so the database URL ships inside a public script and the rules have to
stay open enough for anonymous clients to read *and write*. The repo also
contains a small Cloudflare Worker (`api/`) that can front the repo and the
database:

* the database credential lives in a Cloudflare secret, never in a client;
* reads, caching and queue pruning happen in one place you control;
* writes are validated, rate-limited and correctly status-coded (the raw
  Realtime Database answers a *refused* write with HTTP 200 and an error body);
* the script falls back to the direct database on its own if the Worker is
  unreachable, and the staff panel footer shows which path is live;
* a remote **kill switch** (`staff/gate`) that stops everyone — the loader before
  it downloads, and clients already running within ~20 seconds — with no repo
  push and no redeploy.

Deploy it, set the two keys plus a database credential, then paste the URL into
**`api.json`** in the repo root —
no Lua edits, and setting `"url": ""` again rolls the whole thing back.

Once it is up, one command stops or starts the script for everyone:

```bash
node api/gate.js off "back in 10 minutes" --for 10m   # re-opens on its own
node api/gate.js on                                   # back on
node api/gate.js status                               # what it looks like now
```

The switch is owner-only, and `--for` means a maintenance window you forget
about cannot lock everybody out — the loader and every running client re-open
themselves when the window passes. Writing the gate goes through the Worker, so it
needs the one-time database credential from section 4 — reads never do, only
writes to `staff`.

→ **Full walkthrough: [api/README.md](api/README.md)** — five-minute deploy, the
complete route list, and an honest section on what a client-side key does and
does not protect.

---

## Controlling nametags from a Discord bot

The tag editor is just a browser calling the GitHub Contents API — a Discord bot
can do the exact same thing (Create / View / Edit / Delete / Transfer / Search
rules, upload images) with a fine-grained GitHub token. Every publish lands
in-game within seconds. Full copy-paste guide: **[DISCORD-BOT.md](DISCORD-BOT.md)**.
