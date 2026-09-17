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
      "hr":      ["7776113959"],
      "support": ["someSupportUser"],
      "trial":   ["someTrialUser"]
    }
  }
}
```

Colors: **founder** = silver · **hr** = white · **support** = green · **trial** = teal ·
**purple** = custom purple. Tier names also accept aliases (`owner`/`dev` → founder,
`admin`/`mod`/`staff` → hr, `helper` → support, `trialstaff`/`trialsupport` → trial,
`custom`/`violet` → purple). Everyone in `ranks` gets
the seal even if they're not in the staff list; staff **without** a rank show white.
Rank changes land on the next launch or with **`!staffrefresh`**.

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

## What the script sends
- `GET https://<your-db>/staff.json` at launch (and on `!staffrefresh`).
- **Staff commands + presence beats** write to `cmd/` and `here/` (see the
  rules in step 2). `here` stores only `username = last-seen` and old entries
  are pruned automatically; `cmd` entries self-expire after 10 minutes.
No SDK, no auth flows.
