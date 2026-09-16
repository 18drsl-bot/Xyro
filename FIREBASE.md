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
    }
  }
}
```

That means: anyone may **read** the staff list (the script needs this), but
nobody can write it over the internet. Only you can change it, signed in to the
Firebase console.

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

Colors: **founder** = silver · **hr** = white · **support** = green · **trial** = teal.
Tier names also accept aliases (`owner`/`dev` → founder, `admin`/`mod`/`staff` → hr,
`helper` → support, `trialstaff`/`trialsupport` → trial). Everyone in `ranks` gets
the seal even if they're not in the staff list; staff **without** a rank show white.
Rank changes land on the next launch or with **`!staffrefresh`**.

## 4. Point the script at it

Open `xyro.lua`, find the two lines near the top (search for `EDIT THESE TWO LINES`):

```lua
H.FIREBASE_URL = "" -- e.g. "https://your-db-default-rtdb.firebaseio.com"
H.FIREBASE_AUTH = "" -- optional: database secret (only if rules require auth)
```

Paste your database URL from step 1 and push the update. That's it — the script
reads `https://<your-db>/staff.json` once at launch (synchronously, so the
admin-only Debug tab exists from the first frame) and merges everyone into the
staff list.

Don't want Firebase? Leave `H.FIREBASE_URL` empty — the hardcoded `ADMIN_IDS`
table right above keeps working exactly as before, and Firebase just adds on
top of it.

### Auth secret (usually not needed)

With the rules from step 2 you don't need any secret. If you ever lock reads
behind auth, paste a **database secret** into `H.FIREBASE_AUTH` (Firebase
console → Project settings → Service accounts → Database secrets). It travels
with every copy of the script, so treat it like a password — the open-read
rules avoid the issue entirely.

## 5. In game

- New staff are picked up on the next script launch, or instantly with
  **`!staffrefresh`** in the command bar.
- Staff get: the **Debug tab**, the **verified badge** on their nametag, and
  any other admin-only behavior, live — same as hardcoded admins.

## What the script sends

One `GET https://<your-db>/staff.json` at launch (and on `!staffrefresh`).
No SDK, no auth flows, no writes from the script ever.
