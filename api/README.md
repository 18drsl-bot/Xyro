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
(this project's default rules do not — see step 4):

```bash
npx wrangler secret put XYRO_KEY      # invent a long random string
npx wrangler secret put FB_SECRET     # optional; skip if your rules are open
```

`fb/worker.js` reads `FB_URL` and `RAW_REPO` from `wrangler.toml`, which is
committed. That is deliberate: the database URL is already public in
`firebase.json`, so it is not a secret — the *credential* is, and that lives in
the secret store. If your database URL ever changes, edit `[vars]` in
`wrangler.toml` and redeploy.

## 2. Check it

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
  "presence_window": 120,
  "queue_ttl": 600
}
```

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

## 4. What "key" does and does not buy you

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

**What it does not buy:** a client that holds *some* key can still send that key.
So a write being "key-authenticated" is not the same as "staff-authenticated".
Today that is fine for the things the key gates (a command queue entry, a
presence beat) because the client was already trusted to write them. It is *not*
fine for anything new and dangerous — a kick, a ban, a rank change. For those,
authorize server-side:

| Option | How | Trade-off |
|---|---|---|
| **Discord bot writes** (recommended today) | The bot runs on your machine with `FB_SECRET`, so it can call `POST /blacklist/<who>` with `XYRO_KEY` and nobody else needs that power. | Needs the bot online when you act. Already documented in `DISCORD-BOT.md`. |
| **Per-staff tokens** | One random token per admin, stored in the database, checked by the Worker. | Revocable per person; nobody can forge another's action. |
| **Discord OAuth** | The Worker verifies the caller's Discord identity against your guild roles. | Most work, strongest; the only option where "who did this" is provable. |

The Worker's `/blacklist` routes are written for the bot path already: keep
`XYRO_KEY` in the bot's environment, never in a client.

## 5. Closing the database (the actual win)

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

## 6. Routes

| Route | Method | Key | Purpose |
|---|---|---|---|
| `/health` | GET | no | self-report: is the database reachable, are reads gated |
| `/version` | GET | if gated | `version.txt` from the repo (edge-cached 60s) |
| `/config` | GET | if gated | `nametags.json` (edge-cached 60s; `?fresh=1` bypasses) |
| `/online` | GET | if gated | presence: `{count, online[], beats{}, window}` |
| `/staff` | GET | if gated | the whole `staff` node |
| `/blacklist` | GET | if gated | just the blacklist map |
| `/blacklist/<who>` | POST | yes | block; body is the reason shown on screen |
| `/blacklist/<who>` | DELETE | yes | unblock |
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

## 7. Day-to-day

```bash
node api/test.js              # 36 route tests against a mocked database, no network
npx wrangler tail             # live request log while you test in game
npx wrangler dev              # run the Worker locally on http://localhost:8787
npx wrangler deploy           # ship a change
```

Free plan limits: **100,000 requests/day**, and this Worker makes one database
call per node read (never more). Presence polling every 2s per player is the
bulk of the traffic — a full lobby for an evening is far inside the free tier.

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| `/health` says `reads: open`, `writes: DISABLED` | You have not set `XYRO_KEY` yet. Writes fail closed on purpose. |
| `403 forbidden: bad or missing key` | `api.json`'s key and the Worker's `XYRO_KEY` differ. Re-copy it. |
| `503 XYRO_KEY is not set` | A write arrived before the secret existed. Run the `wrangler secret put` line. |
| `502 ... Permission denied` | Your rules refuse the Worker. Set `FB_SECRET`, or publish rules that allow it. |
| `502 database unreachable` | `FB_URL` in `wrangler.toml` is wrong, or the database is paused. |
| Script footer says `mode firebase` while you expect `api` | Three API calls in a row failed and the client demoted itself to the direct path. The footer also names the reason (`transport.lastPollErr`). |
| Editor still shows the old live-users behaviour | `index.html` is edge-cached by GitHub Pages for ~10 minutes — hard-refresh (Ctrl+Shift+R). |
