# Xyro
A Script Hub made by x9kzx and Vertxxy

discords: @vertxxy @x9kzx

## Load (executor one-liner)

```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/vertxxy-1/Xyro/main/loadstring.lua"))()
```

The loader downloads `xyro.lua` fresh every run (retries 3x and rejects truncated downloads), so script updates go live for everyone the moment they're pushed here — no re-copying code.

## Commands (default prefix `!`)

| Command | Aliases | What it does |
|---|---|---|
| `!help` | | Opens the searchable command list |
| `!nametags` | `!tags` | Toggles website nametags on/off |
| `!nametagsfetch` | `!tagsfetch` | Re-fetches nametags.json right now |

Plus ~90 more: fly, speed, ESP, hitbox, teleports, serverhop, and the rest — see `!help` in game.

## Nametags — edit on this website

Nametags are driven by **`nametags.json` in this repo**. Edit it right here on github.com (open the file → pencil icon → edit → Commit changes) and every player running Xyro picks it up within **60 seconds**, or instantly with `!nametagsfetch`. Rules are only fetched when nametags are toggled on (or at startup) — no requests while off.

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

**`tags`** rules, first match wins (put exact names before broad prefixes):
- `match` — start of username or display name, case-insensitive (`"x9ksa"` matches `x9ksa123`); `"*"` matches everyone
- `label` — the text drawn above the player's head
- `color` — optional hex color (default white)
- `size` — optional per-rule text size override

Requires an executor with the `Drawing` API (Solara, Synapse, Wave, etc.) — `!nametags` tells you if yours doesn't have it.
