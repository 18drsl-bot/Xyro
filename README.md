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

`nametags.json` controls everything, and **the API hosts it**: with `api.json` set,
the game reads the rules from `GET /nametags` and every seal and badge from
`GET /media/<file>` on your own Worker (`api/README.md` section 7), so no GitHub CDN or
jsDelivr edge sits between a publish and a client. Without an API configured it falls
back to raw GitHub and double-checks via the GitHub API every ~60s, exactly as before.
It re-fetches automatically every 15 seconds, or run `!nametagsfetch` for instant reload.

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

Badges look after themselves: a seal whose colour would blend into its pill (the
white HR seal on a white pill, the navy partner seal on a black one) is drawn flat
black on a light pill or flat white on a dark one instead. The check is cut out of
the seal, so it takes the pill's colour either way and still reads as a check. A
seal that already contrasts is left exactly as it is, so nothing needs configuring
and a background image is judged by the rule's `bg` (or the global `pillColor`),
which is the same colour the site previews against.

**Options:** `size` · `userSize` · `height` · `imageSize` · `maxDistance` (studs, 0 =
always) · `showDistance` · `showHealth` · `showBox` (pill background on/off) ·
`onlyScriptUsers` (tags require presence — set false to tag everyone matching) ·
`pillColor` / `pillTransparency` (defaults for rules without `bg`) · `font` ·
`textColor` · `userColor` · `clickTeleport` (click a pill to teleport to that player — works both full-size and collapsed) · `collapseFar` / `collapseDistance` / `collapsedIcon` (icon-only mode: a tag past `collapseDistance` studs shrinks to just its icon, and zooming the camera out past that many studs from your own character collapses every tag so you see only icons. Icons still click-teleport, and hovering the mouse near one expands the full pill while it's on screen. `0` disables it entirely) ·`staffOnly` (when true, only Xyro staff get tags at all — non-staff see nothing, cache nothing) · `refreshSeconds` (how often
the script re-checks for published changes, 10–300, default 15)

Tags render as plain billboard UI, so **any executor works** — no Drawing API needed.
Icons support PNG/JPG/GIF by URL, asset id, or base64 `data:` URI - **GIFs fully animate** (decoded frame-by-frame in script, since Roblox only shows a GIF's first frame). Rules also take `bgImage` (URL or data URI) to fill the pill background; the editor's **Choose file** buttons upload images to `media/` in this repo.

**Reference artwork, do not embed it.** A rule that carries a base64 `data:` URI is re-downloaded by *every* player on *every* refresh (`refreshSeconds`, 15s by default) and re-decoded in Lua each time, so one embedded background is enough to make every tag in the server feel slow - a single 1.29 MB PNG took `nametags.json` to 1.72 MB before this was caught. Wrapping a file in a `data:` URI splits it into 4/3 of its size as printable text as well. **Choose file** checks whether that exact picture is *already* served at `media/<sha1>.<ext>` and reuses that URL (a HEAD, no key needed), and otherwise uploads it through the API with your owner key. It only falls back to embedding when there is no API or no key saved, and then it tells you how many KB that adds to every player's download. `api/test.js` fails the build if the shipped rules carry a large inline image or reference a `media/` file that does not exist.

The editor is a web page - nothing runs on your PC; publish straight from it. Two

 addresses serve the same editor, and the second is the faster one:

- https://vertxxy-1.github.io/Xyro/ (GitHub Pages; caches the page for ~10 minutes,
  so a new build needs Ctrl+Shift+R)
- **https://xyro-api.xyroapi.workers.dev/editor** (served by the API itself: cached for
  60s, same origin as publishing - no cross-origin preflight - and it arrives knowing
  where the API is, so it opens one request sooner)

Either way it paints the last copy your browser saw before the network answers, so
opening it is instant, and a publish is a single round trip.

It reads the rules and the tag artwork through the **Xyro API** (`GET /nametags`,
`GET /media/<file>`), which is the file rather than a CDN's memory of it - so "the site
does not match what the game shows" cannot happen from a stale cache, and no GitHub
token or rate-limit budget is involved. With the owner key saved in the **Publish
through the Xyro API** card, **Publish** writes through your Worker too: no GitHub
login, a stale tab is refused instead of clobbering a newer revision, and the Worker
drops its cache as part of the write. That one key is the page's only credential -
reading needs none, and creating a rule's artwork (`POST /media/<file>`) uses the same
key, so the browser never holds a GitHub token. After a publish it reads the rules back
and says so, and if the read disagrees it says that instead of claiming success. The
header chip (`build: api-r14`) names the build
the page is actually running, so if a hard refresh (Ctrl+Shift+R) is needed you can
see it.

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
on purpose (otherwise anyone could blacklist a rival); `!blocked` prints the
current list in game, and `!staffrefresh` picks changes up instantly.

Manage it from the **Blacklist card in the editor**
(https://xyro-api.xyroapi.workers.dev/editor, next to the live user list): type a
username or id plus a reason and press **Block**, or press **block** on anyone in
the live list to fill that in for you. Each entry has an **Unblock** button.
Editing needs your owner key, which is also why the card will not write without
one - the public client key is what the game uses to read the list, and an edit
route behind it would let any player block a rival. Under the hood it is
`POST`/`DELETE /blacklist/<who>` (see api/README.md section 8); the Firebase
console still works too.

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

A bot edits the same rules through **your own Worker**, with **one credential**:
`XYRO_ADMIN_KEY`. No GitHub token, no CDN purge, no database secret.

```js
const xyro = require("./api/nametags-client.js");
await xyro.edit(r => xyro.set(r, { match: "newbie", label: "New", color: "#6C80FF" }));
```

`api/nametags-client.js` is dependency-free and reads, edits, blocks and
unblocks. `xyro.edit()` retries on a 409 by re-reading, so a bot can never
trample an edit made in the web editor at the same moment.

**Do not commit `nametags.json` from the bot.** The rules live in the Worker's
database and `GET /nametags` serves that first, so a repo commit changes git
history and nothing a player sees — it looks like it worked and does nothing.

Full copy-paste guide, including a complete `/nametag` slash command:
**[DISCORD-BOT.md](DISCORD-BOT.md)**.

**Hosting it on Cloudflare:** `/block`-style slash-command bots work well there -
`api/bot/` is a ready Worker for Discord's HTTP interactions endpoint, and it
needs no always-on host. A bot that reads chat cannot be hosted there at all:
Discord blocks gateway (persistent WebSocket) connections from Cloudflare, so
message events, member joins and presence are off the table.

One trap worth knowing before you deploy it: a Worker may not `fetch()` another
Worker on the **same zone**, so `xyro-bot` cannot call `xyro-api` over its public
URL - Cloudflare answers error `1042`, which surfaces as `404 error code: 1042`
and reads like a missing route. Both live on one `*.workers.dev` subdomain, so
that path never worked. The two talk over a **service binding**, which is already
configured in `api/bot/wrangler.toml`. `node Tools/test_bot_live.js` checks the
deployed endpoint, and `--selftest` signs real interactions to prove it.

Because there is no gateway, the bot shows as **offline** in your member list -
that is structural, not a setting, and every command works anyway. `api/bot/presence.js`
is a small dependency-free gateway keeper (`node api/bot/presence.js`) that gives
it a green dot by running somewhere always-on; it holds presence and nothing else,
so commands still go to the Worker. Don't deploy it to Cloudflare - that is the
one thing Workers can't do.
