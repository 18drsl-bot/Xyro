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
  "database_secret": "not set (fine while rules allow anonymous access)",
  "reads": "key required",
  "writes": "key required",
  "admin_writes": "admin key required",
  "gate": { "enabled": true, "message": "", "source": "default" },
  "presence_window": 120,
  "queue_ttl": 600
}
```

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

**Three ways to trip it.** First, curl against the API:

```bash
export ADMIN=your-xyro-admin-key
export API=https://xyro-api.you.workers.dev

# stop everyone, with a message they will see
curl -X POST "$API/gate/off" -H "x-api-key: $ADMIN" -d "down for a few minutes"

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

**Two deliberate design choices**, both worth knowing:

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
2. **Restrict the rules** so only an authenticated caller can read. Firebase's
   classic *database secret* does this (`FB_SECRET` here), and older projects
   still have one under **Realtime Database → Data → Rules**, but Firebase has
   been deprecating them; on a project without a secret, the equivalent is a
   service-account **ID token**, which the Worker can hold and refresh (a
   `FB_TOKEN` variable plus a small token exchange in `worker.js`).

Once rules are locked, an attacker who extracts `XYRO_KEY` can still hit the
Worker — but cannot reach the database, and rotating `XYRO_KEY`
(`npx wrangler secret put XYRO_KEY`) invalidates every extracted copy at once.
That is the property the direct-to-database setup can never have.

## 7. Routes

| Route | Method | Key | Purpose |
|---|---|---|---|
| `/` `/status` | GET | no | status page for humans (auto-refreshes every 30s) |
| `/health` | GET | no | the same as JSON: database, keys, and the current gate |
| `/gate` | GET | if gated | the kill switch: `{enabled, message, warn, by, source}` |
| `/staff/gate.json` | GET | if gated | the same thing database-shaped (this is what the script polls) |
| `/gate` | POST | **admin** | patch `{enabled, message, warn}`; partial patches merge |
| `/gate/off` `/gate/on` | POST | **admin** | trip / clear the switch; the body is the on-screen message |
| `/script` | GET | if gated | the script itself, `403` while the gate is off |
| `/version` | GET | if gated | `version.txt` from the repo (edge-cached 60s) |
| `/config` | GET | if gated | `nametags.json` (edge-cached 60s; `?fresh=1` bypasses) |
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

The `/cmd.json` and `/here.json` families deliberately mirror the Realtime
Database REST API. That is why the script needed no logic change: it builds
`<base>/cmd.json` either way, and the Worker answers in the same shape.

Only `staff`, `cmd` and `here` are proxied. The Worker is **not** a generic
database proxy — any other path is a 404, so a leaked URL cannot be used to walk
the rest of your database.

## 8. Day-to-day

```bash
node api/test.js              # 36 route tests against a mocked database, no network
npx wrangler tail             # live request log while you test in game
npx wrangler dev              # run the Worker locally on http://localhost:8787
npx wrangler deploy           # ship a change
```

Free plan limits: **100,000 requests/day**, and this Worker makes one database
call per node read (never more). Presence polling every 2s per player is the
bulk of the traffic — a full lobby for an evening is far inside the free tier.

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `/health` says `reads: open`, `writes: DISABLED` | You have not set `XYRO_KEY` yet. Writes fail closed on purpose. |
| `403 forbidden: bad or missing key` | `api.json`'s key and the Worker's `XYRO_KEY` differ. Re-copy it. |
| `503 XYRO_KEY is not set` | A write arrived before the secret existed. Run the `wrangler secret put` line. |
| `503 XYRO_ADMIN_KEY is not set` | Admin routes (blacklist, gate) are off until you set that secret. |
| `/script` answers `403 Xyro is disabled: ...` | The gate is off. That is the kill switch working, not a bug. |
| Everyone stayed online while the gate says disabled | `/health` will say `"source":"unreachable"` — the Worker cannot read the database, and an unreadable gate fails open on purpose. |
| One client ignores the gate | It is older than v0.8.12 (no gate polling), or its own reads failed and it fell back to the database directly. |
| `502 ... Permission denied` | Your rules refuse the Worker. Set `FB_SECRET`, or publish rules that allow it. |
| `502 database unreachable` | `FB_URL` in `wrangler.toml` is wrong, or the database is paused. |
| Script footer says `mode firebase` while you expect `api` | Three API calls in a row failed and the client demoted itself to the direct path. The footer also names the reason (`transport.lastPollErr`). |
| Editor still shows the old live-users behaviour | `index.html` is edge-cached by GitHub Pages for ~10 minutes — hard-refresh (Ctrl+Shift+R). |
