# Firebase staff list

Move the staff/admin list off the hardcoded IDs in `xyro.lua` and into a free
Firebase Realtime Database. Change who's staff from any browser — no script
update, no repo push. Everyone running the script picks it up next launch, or
instantly in-game with `!staffrefresh`.

## 1. Create the database (2 minutes, free)

1. Go to https://console.firebase.google.com/ and click **Add project**
   (name it anything, e.g. `xyro`). Google Analytics: disable, it's not needed.
2. In the left sidebar: **Build → Realtime Database → Create Database**.
3. Location: pick whichever is closest (e.g. `us-east1` or `europe-west1`).
   Start in **locked mode** — you'll open it in the next step.
4. You now have a URL like `https://xyro-abc123-default-rtdb.firebaseio.com/`.
   That's your **database URL** — copy it, you'll paste it into the script.

## 2. Set the database rules

In the Firebase console open **Realtime Database → Rules**, replace everything
with this, and click **Publish**:

```json
{
  "rules": {
    "staff": {
      ".read": true,
      ".write": false
    },
    "cmd": {
      ".read": true,
      ".write": true
    },
    "here": {
      ".read": true,
      ".write": true
    }
  }
}
```

That means: anyone may **read** the staff list (the script needs this), but
nobody can write it over the internet. Only you can change it, signed in to the
Firebase console.

The `cmd` and `here` nodes are the **staff-command queue and presence feed**
(the script writes commands and heartbeats here instead of ntfy, whose free
tier daily quota was getting exhausted and silently dropping staff commands).
They hold no personal data: `cmd` holds short-lived command strings (auto-pruned
after 10 minutes), `here` holds just `username = last-seen-timestamp`.

## 3. Add your staff

In **Realtime Database → Data**, click the `+` next to the root and add a
`staff` node. Easiest layout is one flat list of Roblox user IDs and/or exact
usernames:

```json
{
  "staff": {
    "admins": [
      "8579040069",
      "7776113959",
      "stellarpAlladium"
    ]
  }
}
```

Prefer per-key entries? Both of these work too — values can be `true`, or a
label like `"owner"` (it's ignored, only the key matters):

```json
{
  "staff": {
    "ids":       { "8579040069": "owner", "7776113959": "admin" },
    "usernames": { "stellarpalladium": true, "vertxxy2": true }
  }
}
```

Rules of thumb:

- **User IDs are safer** than usernames — usernames can be renamed.
- Usernames are matched **case-insensitively**.
- A numeric key/value is always treated as a user ID; anything else is a username.
- To remove staff: delete their entry in the console. (`false` also works as a value.)

## 3b. Rank tiers (badge colors)

Add a `ranks` node next to `admins` to give staff **colored verified seals**:

```json
{
  "staff": {
    "admins": ["8579040069", "stellarpAlladium"],
    "ranks": {
      "founder": ["8579040069", "stellarpAlladium"],
      "developer": ["someDeveloper"],
      "hr":      ["7776113959"],
      "support": ["someSupportUser"],
      "trial":   ["someTrialUser"]
    }
  }
}
```

Colors: **founder** = silver · **developer** = red · **hr** = white · **support** = green ·
**trial** = teal · **purple** = custom purple · **partner** = dark blue. Tier names also
accept aliases (`owner` → founder, `dev`/`developer`/`devteam` → developer,
`admin`/`mod`/`staff` → hr, `helper` → support, `trialstaff`/`trialsupport` → trial,
`custom`/`violet` → purple, `navy`/`darkblue` → partner). Everyone in `ranks` gets
the seal even if they're not in the staff list; staff **without** a rank show white.
Rank changes land on the next launch or with **`!staffrefresh`**.

## 3c. Blacklist

Add a `blacklist` node next to `admins` to block an account from using the
script. Keys are **exact Roblox user IDs or usernames**, values are the reason
shown to them on screen (optional):

```json
{
  "staff": {
    "admins": ["8579040069"],
    "blacklist": {
      "1234567890": "ban evasion",
      "someLeaker": "leaking the script"
    }
  }
}
```

These shapes all work (pick whichever is easier):

```json
{ "blacklist": ["1234567890", "someLeaker"] }
{ "blacklist": { "ids": ["1234567890"], "usernames": ["someLeaker"] } }
{ "blacklist": { "1234567890": true, "someLeaker": true } }
```

What a listed account gets:

- **No UI at all** — the window, staff panel and Debug tab never appear; a
  "Xyro - access blocked" card shows the reason instead
- **No nametag, no presence, no command transport** — they stop heartbeating,
  so they drop off the editor's *Script users* list within ~75 seconds
- **Nobody else's client tags them either** — the tag suppression runs on every
  *other* player's client, which is the part a blacklisted user cannot bypass
  by editing their copy of the script

Manage it in the **Firebase console** (Data → `staff` → `blacklist`). It is
intentionally **read-only for clients**: if scripts could write it, anyone could
blacklist a rival. Changes apply on the next launch, or immediately with
**`!staffrefresh`** — which also *un*-blocks: clear the entry and refresh.

In game, staff can print the current list with **`!blocked`**.

## 4. Point the script at it (no script edits!)

Add a **`firebase.json`** file to the **repo root** with your database URL:

```json
{
	"firebase": {
		"url": "https://xyro-abc123-default-rtdb.firebaseio.com"
	}
}
```

Push it (or use the tag editor's token flow / the GitHub web UI — any repo
commit works). At launch the script reads this file — GitHub API first (never
CDN-cached), then raw GitHub with a cache-buster, then the jsDelivr edge — and points
itself at your database. It then reads `https://<your-db>/staff.json`
(synchronously, so the admin-only Debug tab exists from the first frame) and
merges everyone into the staff list. Change the URL any time by editing this
one file — no `xyro.lua` edits, ever.

Prefer editing the script? The two `EDIT THESE TWO LINES` lines in `xyro.lua`
(`H.FIREBASE_URL` / `H.FIREBASE_AUTH`) still work and **override** the repo
file — handy for private test databases.

Don't want Firebase? Leave `firebase.json`'s `url` empty (or the file absent)
and `H.FIREBASE_URL` empty — the hardcoded `ADMIN_IDS` table keeps working
exactly as before.

The file also accepts a bare URL as its whole body, or a flat
`{ "url": "...", "auth": "..." }` — but the nested `firebase` form above is
the canonical one.

### Auth secret (usually not needed)

With the rules from step 2 you don't need any secret. If you ever lock reads
behind auth, add `"auth": "<database secret>"` next to the `url` in
`firebase.json` (Firebase console → Project settings → Service accounts →
Database secrets). It travels with every copy of the script, so treat it like
a password — the open-read rules avoid the issue entirely.

## 5. In game

- New staff are picked up on the next script launch, or instantly with
  **`!staffrefresh`** in the command bar.
- Staff get: the **Debug tab**, the **verified badge** on their nametag, and
  any other admin-only behavior, live — same as hardcoded admins.
- Staff can read the blacklist with **`!blocked`** (aliases: `!blacklist`).
- A blacklisted account is refused before any feature mounts, so it never even
  reaches the point of showing a window.

## Hardening it later: the Xyro API (optional)

The rules above let anonymous clients read the staff node and write the `cmd` /
`here` nodes. That is what makes the script work with no setup, but it also means
anyone holding the database URL — it is in `firebase.json`, in a public repo —
can read your admin list and blacklist.

The repo includes a Cloudflare Worker (`api/`) that sits in front of the
database: clients talk to the Worker, the Worker holds the database credential,
and the rules can then be closed to the public. Point clients at it by filling in
`api.json` in the repo root; nothing about the nodes or their shapes changes,
and an empty `api.json` url keeps today's direct behaviour.

→ **[api/README.md](api/README.md)** — deploy, secrets, routes, and the
database-lockdown steps (including what to do if your project has no legacy
database secret).

## What the script sends
- `GET https://<your-db>/staff.json` at launch (and on `!staffrefresh`) — or
  `GET https://<your-worker>/staff.json` when `api.json` points at the API.
- **Staff commands + presence beats** write to `cmd/` and `here/` (see the
  rules in step 2). `here` stores only `username = last-seen` and old entries
  are pruned automatically; `cmd` entries self-expire after 10 minutes.
No SDK, no auth flows.
