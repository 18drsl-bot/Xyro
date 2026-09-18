# Xyro API (Cloudflare Worker)

A thin, owner-controlled front door in front of the repo and the database.

Before this, every client talked to two third-party hosts directly:

```
xyro.lua  ->  raw.githubusercontent.com / cdn.jsdelivr.net   (config files)
          ->  <your-db>.firebaseio.com                       (staff list, command
                                                              queue, presence)
```

That means the database URL ships inside a public script, and the database rules
have to stay open enough for anonymous clients to read **and write**. With the
Worker in front, the database credential lives in a Cloudflare environment
variable no client ever sees, writes are validated and status-coded, and one
stable URL serves the script, the editor and the Discord bot.

**Nothing here is required.** With `api.json` left empty the script and the
editor behave exactly as they do today. Turning the API on (or off) is one repo
commit — never a script edit.

---

## 1. Deploy it (about five minutes)

You need a free Cloudflare account and Node installed (for `npx wrangler`).

```bash
cd api
npx wrangler login          # opens a browser, authorises this machine once
npx wrangler deploy
```

The first deploy prints your URL:

```
https://xyro-api.<your-subdomain>.workers.dev
```

Now set the two values that must never be in the repo. `XYRO_KEY` is the key
clients send; `FB_SECRET` is only needed if your database rules require auth
(this project's default rules do not — see step 5):

```bash
npx wrangler secret put XYRO_KEY        # the CLIENT key: ships to every script user
npx wrangler secret put XYRO_ADMIN_KEY  # the OWNER key: you + your Discord bot only
npx wrangler secret put FB_SECRET       # optional; skip if your rules are open
```

Two more secrets are optional, and each unlocks one thing:

```bash
npx wrangler secret put FB_SERVICE_ACCOUNT  # lets the Worker write staff/gate (section 4)
npx wrangler secret put GH_TOKEN            # lets it read + publish nametags.json (section 7)
```

`GH_TOKEN` is a **fine-grained GitHub token with Contents: Read and write** on
this repo. With it, the tag rules are read straight from the never-cached
GitHub API (so no 60-per-hour IP limit applies at Cloudflare's shared egress)
and `PUT /nametags` can publish for you. Without it, reads fall back to
`raw.githubusercontent` with a cache-buster — still fresh, just less
authoritative — and publishing simply stays unavailable.

The two keys are separate on purpose. `XYRO_KEY` is in `api.json` in a public
repo, so treat it as public: it can read, heartbeat and enqueue commands, and
nothing else. `XYRO_ADMIN_KEY` never leaves your machine, and it is the only
thing that can write the blacklist or trip the kill switch — otherwise the key
every player can extract would also let them block a rival or shut everyone down.

`fb/worker.js` reads `FB_URL` and `RAW_REPO` from `wrangler.toml`, which is
committed. That is deliberate: the database URL is already public in
`firebase.json`, so it is not a secret — the *credential* is, and that lives in
the secret store. If your database URL ever changes, edit `[vars]` in
`wrangler.toml` and redeploy.

## 2. Check it

Open the Worker URL in a browser and you get a **status page** — one line
answering "is it down?": `LIVE`, `DISABLED` (the kill switch is on) or
`DEGRADED` (the API cannot reach the database), plus the gate message, who set
it, how many players are running the script right now and the version being
served. It refreshes itself every 30 seconds, so it is also the link to hand
someone who asks during maintenance.

`/health` is the same information as JSON, for scripts and uptime checkers:

```bash
curl https://xyro-api.<you>.workers.dev/health
```

```json
{
  "ok": true,
  "database": "configured",
  "database_secret": "not set (fine while rules allow anonymous reads)",
  "database_auth": "service account",
  "reads": "key required",
  "writes": "key required",
  "admin_writes": "admin key required",
  "gate": { "enabled": true, "message": "", "source": "default" },
  "presence_window": 75,
  "queue_ttl": 600
}
```

`presence_window` is deliberately the same 75 seconds the game and the editor
use (`NT_BEAT_WINDOW` in xyro.lua, `PRESENCE_WINDOW` in index.html). It was 120
here against their 75, which made `/online` and the status page count a player
as running for 45 seconds after the game had already taken their tag away.
`Tools/test_contract.js` fails if the three ever drift apart again.

`gate.source` is worth knowing: `default` means no gate node exists, `database`
means it was read, and `unreachable`/`unreadable` mean the Worker could not get
an answer — in which case everyone **keeps running** (see section 4).

Then confirm it can actually see your data (add `?key=...` once reads are gated):

```bash
curl "https://xyro-api.<you>.workers.dev/staff"     # your admin list
curl "https://xyro-api.<you>.workers.dev/online"    # who is running the script
curl "https://xyro-api.<you>.workers.dev/version"   # repo version.txt
```

## 3. Point clients at it

Paste your URL and key into **`api.json`** in the repo root and commit it:

```json
{
  "api": {
    "url": "https://xyro-api.you.workers.dev",
    "key": "the XYRO_KEY you invented"
  }
}
```

That is the whole rollout. At launch:

* **`xyro.lua`** reads `api.json` (GitHub API → raw → jsDelivr, same order as
  `firebase.json`) and switches its staff list, command queue and presence to the
  Worker. The database address from `firebase.json` is still read and kept as a
  **fallback**: three consecutive API failures and the client quietly drops back
  to talking to the database directly, and the footer says `mode api` or
  `mode firebase` so you can see which path is live.
* **`index.html`** reads `api.json` too, so the editor's live-users and staff
  views go through the Worker (it logs `[xyro] live users + staff via the Xyro
  API` in the console when it does).

Hand out the loader the same way, and no GitHub URL ever reaches a client:

```lua
loadstring(game:HttpGet("https://xyro-api.<you>.workers.dev/loader"))()
```

To roll back: set `"url": ""` and commit. Everything returns to Firebase on the
next launch.

## 4. The kill switch

One value controls every client. No redeploy, no repo push, no script update:

```json
{ "staff": { "gate": { "enabled": false, "message": "back in 10 minutes" } } }
```

What happens within ~20 seconds:

* the **loader** refuses to start — it checks the gate *before* downloading
  anything, so nobody even pulls the source;
* clients **already running** tear their UI down and show an amber card with your
  message — no window, no tags, no presence, no command transport;
* the API's **`GET /script`** answers `403` with your message, so a loader pointed
  at the API cannot fetch the script at all;
* **`!gate`** in game prints the current state (staff only), and `!staffrefresh`
  applies a change on that client instantly.

### The one-time credential the switch needs

This database **allows anonymous reads but refuses anonymous writes to
`staff`** — and the gate lives at `staff/gate`. So `POST /gate` needs the Worker
to hold a credential of its own; without one it answers
`403 ... this database refuses anonymous writes to it`, which is exactly how a
broken CLI used to look like a broken deploy.

One secret fixes it. In the Firebase console: **⚙ Project settings → Service
accounts → Generate new private key**, which downloads a JSON file. Then:

```bash
npx --yes wrangler@latest secret put FB_SERVICE_ACCOUNT   # paste the WHOLE file
npx --yes wrangler@latest deploy
```

Paste the whole `{ ... }` at the prompt (quotes and all), then confirm on
`/health`:

```json
"database_auth": "service account",
```

`database_auth` reads `service account`, `service account (unusable)`,
`legacy database secret` or `anonymous - reads only...`, and
`database_auth_error` carries the reason when one is configured but broken.
**Reads never need it**: with no credential, or a broken one, every read still
works and only the writes the rules forbid report the problem.

The Worker signs a JWT with that key, trades it for an access token and caches it
until it expires — roughly one exchange an hour, not one per request — so a
trip is still a single fast call. The equivalent split secrets
(`FB_CLIENT_EMAIL` + `FB_PRIVATE_KEY`) work too, and a legacy secret can be set
as `FB_SECRET` instead (it takes precedence and skips the exchange).

**Easiest: the control command that lives next to this file.** It reads the URL
from `api.json` and the owner key from `XYRO_ADMIN_KEY` (or `api/.xyro-admin-key`,
which is gitignored):

```bash
node api/gate.js status                        # what the gate looks like now
node api/gate.js off "down for 10 minutes"      # switch the script off
node api/gate.js off "back soon" --for 10m      # ...and re-open by itself
node api/gate.js extend 20m                     # push an open window further out
node api/gate.js on                            # let everyone back in
node api/gate.js warn "restarting in 10 min"     # announcement, nobody stopped
node api/gate.js clear-warn                    # remove the announcement
```

Save the key once and every later command is a single line:

```bash
# PowerShell
"your-admin-key" | Out-File -Encoding ascii api/.xyro-admin-key
# bash
echo your-admin-key > api/.xyro-admin-key
```

**`--for` is the one worth remembering.** The switch re-opens on its own when the
window passes, so a maintenance window you forgot about cannot lock everybody out
for a day. No cron, no reminder: the loader and every client read the same `until`
timestamp and stop treating the gate as closed the moment it expires. The status
page counts it down for you.

Or with curl / your Discord bot:

```bash
export ADMIN=your-xyro-admin-key
export API=https://xyro-api.you.workers.dev

# stop everyone, with a message they will see
curl -X POST "$API/gate/off" -H "x-api-key: $ADMIN" -d "down for a few minutes"

# the same, with a window: back on automatically in 10 minutes
curl -X POST "$API/gate/off?for=600" -H "x-api-key: $ADMIN" -d "down for a few minutes"

# let them back in
curl -X POST "$API/gate/on"  -H "x-api-key: $ADMIN"

# or a partial patch: an announcement that does NOT stop anyone
curl -X POST "$API/gate" -H "x-api-key: $ADMIN" -H "content-type: application/json" \
  -d '{"warn":"restarting in 10 minutes"}'
```

`warn` is the gentle half of the switch: every client shows the text once and
keeps running. It is the right tool for "update soon" and "maintenance in 10" —
and it clears itself when you post a new one.

Second, **your Discord bot** (the key stays on your machine) — see
**[DISCORD-BOT.md](../DISCORD-BOT.md)**.

Third, the **Firebase console**: set `staff/gate/enabled` to `false` by hand.
That works with no API deployed at all, because the loader and the script both
know how to read the gate straight from the database when `api.json` has no url.
Add `"until": <unix seconds>` there too if you want a window, and delete the
node (or set `enabled: true`) to re-open.

**Three deliberate design choices**, all worth knowing:

* **A window can close itself.** `until` is absolute, not a duration, so it
  survives clock drift and a client that slept through the window: every reader
  compares it to *its own* clock and re-opens on its own.

* **A gate that cannot be read counts as ON.** If the database is down, denied or
  has no `gate` node, everyone keeps running. A database hiccup must never be able
  to take the script away from everybody at once.
* **Only the admin key can trip it.** The client key cannot write the blacklist or
  the gate, so a leaked client key cannot shut your users down or block a rival.

**The honest limit:** a kill switch lives inside clients you ship, so someone who
edits their own loader can strip the check — the same caveat as everything else
client-side (section 5). What it stops, reliably, is the public one-liner and
everyone who did not go to that trouble: their loader fetches the source
*through this API*, and this API stops answering.

## 5. What "key" does and does not buy you

Read this before believing the key is security.

**The key is inside a public repo file.** It is extractable, and so is anything
shipped in the Lua client. What it buys is real but modest:

* reads stop being scrapeable by a stranger who finds the database URL;
* writes are validated (`<userId>|<name>|<cmd>` shape, size caps, key format),
  rate-limited, and rejected with a real status code instead of Firebase's
  habit of answering a refused write with HTTP 200 and `{"error": ...}`;
* the **database credential is server-side**, so the database can be closed to
  the public and only the Worker keeps access — the key can leak and the
  database still doesn't.

**The keys are split, and that is what makes it usable.** `XYRO_KEY` (public,
shipped in `api.json`) may read, heartbeat and enqueue commands. `XYRO_ADMIN_KEY`
(never in a client) is required for the blacklist and the kill switch. So the key
every player can extract cannot do anything dangerous — which is exactly the
mistake a single key would have been, and the reason the kill switch needed the
second one before it could exist.

**What it does not buy:** a client that holds *some* key can still send that key.
So a write being "key-authenticated" is not the same as "staff-authenticated".
Today that is fine for the things the client key gates (a queue entry, a presence
beat) because clients were already trusted to write them. It is *not* fine for
anything new and dangerous — a kick, a ban, a rank change. For those, authorize
server-side:

| Option | How | Trade-off |
|---|---|---|
| **Discord bot writes** (recommended today) | The bot runs on your machine with `FB_SECRET`, so it can call `POST /blacklist/<who>` with `XYRO_KEY` and nobody else needs that power. | Needs the bot online when you act. Already documented in `DISCORD-BOT.md`. |
| **Per-staff tokens** | One random token per admin, stored in the database, checked by the Worker. | Revocable per person; nobody can forge another's action. |
| **Discord OAuth** | The Worker verifies the caller's Discord identity against your guild roles. | Most work, strongest; the only option where "who did this" is provable. |

The Worker's `/blacklist` routes are written for the bot path already: keep
`XYRO_KEY` in the bot's environment, never in a client.

## 6. Closing the database (the actual win)

Right now `staff.json` is world-readable — anyone with the URL (it is in a public
repo) can read your admin list and blacklist. Closing it is a two-part change,
and the Worker is what makes part one possible:

1. **Move every client onto the API** (step 3 above) so nothing anonymous needs
   the database any more.
2. **Restrict the rules** so only an authenticated caller can read. The
   credential from section 4 is exactly this: set `FB_SERVICE_ACCOUNT` and every
   Worker request is already an owner, whatever the rules say. (Firebase's
   classic *database secret* also works as `FB_SECRET`, but it is deprecated.)
   Once that secret is set, publish rules like these:

   ```json
   {
     "rules": {
       "staff": { ".read": false, ".write": false },
       "cmd":   { ".read": false, ".write": false },
       "here":  { ".read": false, ".write": false }
     }
   }
   ```

   The Worker keeps working because it authenticates as an owner; anyone else —
   including a stranger who found the database URL — gets `Permission denied`.
   Note that closing `cmd`/`here` also closes the **direct-database fallback** in
   the script and the loader (section 3), so every client must be on the API
   first.

Once rules are locked, an attacker who extracts `XYRO_KEY` can still hit the
Worker — but cannot reach the database, and rotating `XYRO_KEY`
(`npx wrangler secret put XYRO_KEY`) invalidates every extracted copy at once.
That is the property the direct-to-database setup can never have.

## 7. The nametags, hosted here

The tag system is the one part of this project that lived entirely on someone
else's CDN: the rules on `raw.githubusercontent`, the seals on jsDelivr. That is
what produced the two bugs that were hardest to explain — *"the editor will not
keep my changes"* (a stale CDN copy arriving right after a publish and being
mistaken for the file) and *"my badge colour is wrong"* (an edge that had not
let go of an old seal yet). Both are the same shape: a cache answering a
question about the file.

So the Worker hosts all of it now, on your own domain:

| What | Where | Freshness |
|---|---|---|
| the rules | `GET /nametags` | 30s edge cache, `?fresh=1` for a guaranteed read |
| the seals and badge | `GET /media/seal_founder.png`, `/media/verified_seal_blue.png` | 300s (the files are immutable once named), `?fresh=1` to override |
| publishing | `PUT /nametags` | commits to `nametags.json` and drops the cache immediately |

The script and the editor both use it: with `api.json` present, the game reads
the rules and every piece of tag artwork from this one origin, and the editor
reads them through it too (a first load included). `raw.githubusercontent` and
jsDelivr survive only as the fallback for a setup with no `api.json`, which is
also why the editor still works if you never deploy any of this.

Nothing here is key-gated, deliberately: the rules are public in the repo, the
editor is a public page, and a key would only stop *you* from seeing what is
actually published. The kill switch does not cut this off either — during
maintenance everyone should still be able to read the rules.

### Publishing through the API (optional)

Set `GH_TOKEN` (fine-grained token, **Contents: Read and write** on this repo)
and the editor can publish without a GitHub login in the browser:

```bash
curl -X PUT https://xyro-api.<you>.workers.dev/nametags \
  -H "x-api-key: YOUR_XYRO_ADMIN_KEY" -H "content-type: application/json" \
  --data-binary @nametags.json
```

* It needs **both** keys in a sense: `XYRO_ADMIN_KEY` proves it is you,
  `GH_TOKEN` is what makes the commit possible. With no `GH_TOKEN` the route
  answers `503` and says so rather than pretending.
* A stale editor can send `?sha=<blob sha>`; GitHub then refuses the write with
  `409` instead of silently overwriting a newer revision. Without it, the Worker
  reads the current sha first — an explicit overwrite.
* A successful publish deletes this Worker's cached copies of the rules, so the
  next reader gets the new revision rather than up to 30 seconds of the old one.
* `GH_TOKEN` can write to your repo, so it belongs in the secret store and
  nowhere else — never in `wrangler.toml`, never in `api.json`.

## 8. Routes

| Route | Method | Key | Purpose |
|---|---|---|---|
| `/` `/status` | GET | no | status page for humans (auto-refreshes every 30s) |
| `/health` | GET | no | the same as JSON: database, keys, and the current gate |
| `/gate` | GET | if gated | the kill switch: `{enabled, message, warn, by, source}` |
| `/staff/gate.json` | GET | if gated | the same thing database-shaped (this is what the script polls) |
| `/gate` | POST | **admin** | patch `{enabled, message, warn, until, for}`; partial patches merge |
| `/gate/off` `/gate/on` | POST | **admin** | trip / clear the switch; the body is the on-screen message, `?for=` sets a window |
| `/script` | GET | if gated | the script itself, `403` while the gate is off |
| `/loader` | GET | no | the loader you hand out (`LOADER_FILE`, default `custom-loader.lua`), `403` while the gate is off |
| `/version` | GET | if gated | `version.txt` from the repo (edge-cached 60s) |
| `/nametags` | GET | no | the published tag rules (edge-cached 30s; `?fresh=1` bypasses) |
| `/nametags.json` `/config` | GET | no | the same bytes under the older names |
| `/nametags` | PUT/POST | **admin** + `GH_TOKEN` | publish the rules: commits `nametags.json`, drops the cache, returns the new sha |
| `/media/<file>` | GET | no | seals, the verified badge and any other tag artwork (edge-cached 300s; `?fresh=1` bypasses) |
| `/online` | GET | if gated | presence: `{count, online[], beats{}, window}` |
| `/staff` | GET | if gated | the whole `staff` node |
| `/blacklist` | GET | if gated | just the blacklist map |
| `/blacklist/<who>` | POST | **admin** | block; body is the reason shown on screen |
| `/blacklist/<who>` | DELETE | **admin** | unblock |
| `/staff.json` | GET | if gated | database-shaped: the `staff` node |
| `/cmd.json` | GET | if gated | database-shaped: only fresh queue entries (stale ones deleted) |
| `/here.json` | GET | if gated | database-shaped: only fresh presence beats |
| `/cmd/<key>.json` | PUT/DELETE | yes | enqueue / consume a command |
| `/here/<key>.json` | PUT/DELETE | yes | presence beat / clear |

Every **admin** route above also needs the database credential from section 4 —
the key proves *who* is asking, the credential is what the database accepts.

`/loader` is the one source route with no key, on purpose: it is what someone
fetches before they have anything, and a key in a hand-out line is a secret you
cannot rotate without breaking every copy of it in circulation. It is still
gate-aware, which is the property that matters — and it rewrites the file's own
`API` and `KEY` lines as it serves it, so the hand-out line stays short and a
rotation is invisible to everyone.

The `/cmd.json` and `/here.json` families deliberately mirror the Realtime
Database REST API. That is why the script needed no logic change: it builds
`<base>/cmd.json` either way, and the Worker answers in the same shape.

Only `staff`, `cmd` and `here` are proxied. The Worker is **not** a generic
database proxy — any other path is a 404, so a leaked URL cannot be used to walk
the rest of your database.

## 9. Day-to-day

```bash
node api/test.js              # 142 route tests against a mocked database and repo, no network
npx wrangler tail             # live request log while you test in game
npx wrangler dev              # run the Worker locally on http://localhost:8787
npx wrangler deploy           # ship a change
```

Free plan limits: **100,000 requests/day**, and this Worker makes one database
call per node read (never more). Presence polling every 2s per player is the
bulk of the traffic — a full lobby for an evening is far inside the free tier.

## 10. Troubleshooting

| Symptom | Cause |
|---|---|
| `/health` says `reads: open`, `writes: DISABLED` | You have not set `XYRO_KEY` yet. Writes fail closed on purpose. |
| `403 forbidden: bad or missing key` | `api.json`'s key and the Worker's `XYRO_KEY` differ. Re-copy it. |
| `503 XYRO_KEY is not set` | A write arrived before the secret existed. Run the `wrangler secret put` line. |
| `503 XYRO_ADMIN_KEY is not set` | Admin routes (blacklist, gate) are off until you set that secret. |
| `/script` answers `403 Xyro is disabled: ...` | The gate is off. That is the kill switch working, not a bug. |
| Everyone stayed online while the gate says disabled | `/health` will say `"source":"unreachable"` — the Worker cannot read the database, and an unreadable gate fails open on purpose. |
| One client ignores the gate | It is older than v0.8.12 (no gate polling), or its own reads failed and it fell back to the database directly. |
| `403 Permission denied - this database refuses anonymous writes to it` | The rules keep `staff` read-only to the public, which is correct. Set `FB_SERVICE_ACCOUNT` (section 4) so the Worker has an owner credential of its own. |
| `403 ... the service account this Worker holds was refused too: ...` | The credential exists but is unusable — the message names why (not JSON, an unreadable key, or Google refusing the exchange). `/health` repeats it under `database_auth_error`. |
| Admin route is `403` but reads work fine | Same cause: reads are allowed anonymously, only writes need the credential. |
| `502 ... Permission denied` | Rules refusing a *read* — publish rules that let an owner (the credential) through, or unset them. |
| `502 database unreachable` | `FB_URL` in `wrangler.toml` is wrong, or the database is paused. |
| `/nametags` answers `502 ... is not {options, tags[]}` | The file on GitHub is not the expected shape (a half-finished edit, or the wrong file). It refuses rather than serving half a rule set to every client. |
| `/media/...` answers `404` | The filename is missing from the repo, or its extension is not a whitelisted image/audio type. Path segments are not allowed. |
| `503 ... needs GH_TOKEN` on `PUT /nametags` | Expected: publishing through the API is off until you set that secret. Reads are unaffected. |
| Tag changes take up to 30s to reach running clients | The Worker's edge cache. `?fresh=1` on a manual read bypasses it, and publishing through the API clears it outright. |
| Script footer says `mode firebase` while you expect `api` | Three API calls in a row failed and the client demoted itself to the direct path. The footer also names the reason (`transport.lastPollErr`). |
| Editor still shows the old live-users behaviour | `index.html` is edge-cached by GitHub Pages for ~10 minutes — hard-refresh (Ctrl+Shift+R). |
