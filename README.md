# Xyro
A Script Hub made by x9kzx and Vertxxy

discords: @vertxxy @x9kzx

## Load (executor one-liner)

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/refs/heads/main/xyro.lua"))()
```

This runs `xyro.lua` straight from the repo, so script updates go live for everyone the moment they're pushed here — no re-copying code.

Prefer extra protection against flaky downloads? This variant retries 3x and rejects truncated files before running:

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/loadstring.lua"))()
```

## Commands (default prefix `!`)

| Command | Aliases | What it does |
|---|---|---|
| `!help` | | Opens the searchable command list |
| `!nametags` | `!tags` | Toggles website nametags on/off |
| `!nametagsfetch` | `!tagsfetch` | Re-fetches nametags.json right now |

Plus ~90 more: fly, speed, ESP, hitbox, teleports, serverhop, and the rest — see `!help` in game.

## Nametags — edit on this website

Nametags are driven by **`nametags.json` in this repo**. Edit it right here on github.com (open the file → pencil icon → edit → Commit changes), and every player running Xyro picks it up within **60 seconds**, or instantly with `!nametagsfetch`. Rules are only fetched when nametags are toggled on (or at startup) — no requests while off.

In game: `!nametags` (alias `!tags`) toggles them; `!nametagsfetch` re-fetches now. Tags render as pill badges above heads — no Drawing API needed, works on every executor.

**Only script users get tagged.** Every running copy heartbeats its username to a shared presence feed every 45s; a tag is drawn only over players seen in the last few minutes. Non-users never show up, even if they match a rule. (Turn off with `"onlyScriptUsers": false`.)

```json
{
	"options": {
		"size": 14,
		"maxDistance": 0,
		"showDistance": true,
		"showHealth": true,
		"showBox": true
	},
	"tags": [
		{ "match": "x9ksa", "label": "OWNER", "color": "#FFD700", "size": 16 },
		{ "match": "vert", "label": "DEV", "color": "#6C80FF" },
		{ "match": "*", "label": "GUEST", "color": "#FFFFFF" }
	]
}
```

**`options`** (all optional, apply to everyone):
- `size` — default text size for tags (8–60, default 14)
- `maxDistance` — hide tags past this many studs (0 = always show)
- `showDistance` — append `[123m]` to tags
- `showHealth` — append `[87hp]` to tags
- `showBox` — dark box behind text for readability
- `onlyScriptUsers` — only draw tags over players confirmed to be running Xyro (default on)
- `pillColor` — default pill background hex (default `#0C0C10`)
- `pillTransparency` — default pill transparency, 0 = solid (default `0.12`)
- `imageSize` — icon size inside the pill in px, 8–28 (default `20`)

**`tags`** rules, first match wins (put exact names before broad prefixes):
- `match` — start of username or display name, case-insensitive (`"x9ksa"` matches `x9ksa123`); `"*"` matches everyone
- `label` — the text drawn above the player's head
- `color` — optional hex color (default white)
- `size` — optional per-rule text size override
- `image` — optional icon shown inside the pill: an `https://...` image URL (png/jpg/webp), a bare asset id number, or `rbxassetid://...`. URLs are downloaded once and cached locally
- `bg` — optional per-rule pill background hex color
- `bgTransparency` — optional per-rule pill transparency (0 = solid, 1 = invisible)

Requires nothing special — tags are plain billboard UI, so any executor that runs the hub can show them. `maxDistance` hides tags past that many studs (0 = always).
