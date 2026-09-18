# Managing nametags from a Discord bot

Your bot edits the nametag rules through **your own Worker**, with **one
credential**: the owner key (`XYRO_ADMIN_KEY`). There is no GitHub token, no
CDN purge and no database secret involved.

`api/nametags-client.js` in this repo does the work. It is dependency-free
(Node 18+ for `fetch`), and it is the same code path the live checker uses.

```js
const xyro = require("./api/nametags-client.js");

const { rules, rev } = await xyro.read();          // the rules + their revision
await xyro.edit(r => { xyro.set(r, { match: "newbie", label: "New", color: "#6C80FF" }); });
```

## Read this first: the repo file is NOT what players read

The rules are a row in the Worker's database, and `GET /nametags` serves the
database **first** - the committed `nametags.json` is only a mirror.

So a bot that commits `nametags.json` with the GitHub Contents API looks like it
works (the commit succeeds, the file changes) and **changes nothing in game**.
That is the trap this page exists to keep you out of. Everything below talks to
the Worker instead.

## Setup (once)

The bot needs your **owner key** on the machine it runs on. Either:

```powershell
# PowerShell, in the repo root
"your-owner-key" | Out-File -Encoding ascii "api\.xyro-admin-key"
```

or set it in the bot's environment: `XYRO_ADMIN_KEY=your-owner-key`.

In order, the client looks at: the `key` option, `XYRO_ADMIN_KEY`,
`api/.xyro-admin-key`, `~/.xyro-admin-key` - the same places `api/gate.js`
looks. The address comes from `api.url` in `api.json`, so it follows the real
deploy.

**This key is the admin key.** It can also trip the kill switch and edit the
blacklist, so it belongs on your machine and nowhere near a client. Never put it
in `api.json` (which is public) and never commit it - it is already in
`.gitignore`. If you would rather a leaked key could not shut the script down
for everyone, set a separate `XYRO_PUBLISH_KEY` on the Worker and give the bot
that instead; it can only publish rules.

Check it once at boot, so a bad key fails on startup and not on the first staff
command:

```js
const health = await xyro.check();
if (!health.ok) throw new Error("xyro: " + JSON.stringify(health.detail));
```

## The four things a bot does

| | |
|---|---|
| `xyro.read()` | `{ rules, rev }` - the rules as they are **now** (`?fresh=1`, past the 30 s edge cache, because you are about to write) |
| `xyro.edit(fn)` | read → change → publish, and if someone publishes in between it does the whole thing again on **their** revision instead of clobbering them |
| `xyro.publish(rules, { rev })` | one guarded write. Throws `err.code === "conflict"` on a 409 |
| `xyro.check()` | is the key accepted, and can the Worker publish |

Pure helpers that work on any document, no network:

```js
xyro.find(rules, "username")   // case-insensitive exact rule lookup, or null
xyro.list(rules)               // every rule's match, in evaluation order
xyro.set(rules, { match, ... }) // add, or replace the rule for that match
xyro.remove(rules, "username")  // -> true when something was removed
```

**Use `edit()`, not `read()` + `publish()`.** The revision guard means a write
is refused if the rules moved since your read - which is what makes publishing
safe, and also means a naive bot gets a 409 whenever anyone uses the web editor
at the same time. `edit()` handles that by re-reading and re-applying your
change, so the last word goes to whoever published, without anyone's edit being
silently reverted.

## A complete slash-command example

```js
const xyro = require("./api/nametags-client.js");
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("nametag")
		.setDescription("Manage Xyro nametags")
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
		.addSubcommand(s => s.setName("set").setDescription("Give someone a tag")
			.addStringOption(o => o.setName("user").setDescription("Roblox username or user id").setRequired(true))
			.addStringOption(o => o.setName("label").setDescription("Text the tag shows").setRequired(true))
			.addStringOption(o => o.setName("color").setDescription("Hex colour, e.g. #6C80FF")))
		.addSubcommand(s => s.setName("remove").setDescription("Take someone's tag away")
			.addStringOption(o => o.setName("user").setDescription("Roblox username or user id").setRequired(true)))
		.addSubcommand(s => s.setName("list").setDescription("Show every tag")),

	async execute(interaction) {
		const sub = interaction.options.getSubcommand();
		await interaction.deferReply({ ephemeral: sub !== "list" });

		try {
			if (sub === "list") {
				const { rules, rev } = await xyro.read();
				const body = rules.tags
					.map((t, i) => `${i + 1}. \`${t.match}\` → **${t.label}** \`${t.color || ""}\`${t.badge ? " ✔" : ""}`)
					.join("\n") || "No tags yet.";
				// don't print an unbounded list into a Discord field
				const text = body.length > 3900 ? body.slice(0, 3900) + "\n..." : body;
				return interaction.editReply({ embeds: [new EmbedBuilder().setTitle(`Nametags (${rules.tags.length})`).setDescription(text).setFooter({ text: `revision ${rev}` })] });
			}

			if (sub === "remove") {
				const user = interaction.options.getString("user");
				let removed = false;
				const out = await xyro.edit(r => { removed = xyro.remove(r, user); });
				return interaction.editReply(removed
					? `Removed the tag for \`${user}\`. In game within ~15s (revision ${out.rev}).`
					: `There is no rule matching \`${user}\`.`);
			}

			const user = interaction.options.getString("user").trim();
			const label = interaction.options.getString("label").trim();
			const color = (interaction.options.getString("color") || "#6C80FF").trim();
			if (!/^#[0-9a-fA-F]{6}$/.test(color)) return interaction.editReply(`\`${color}\` is not a hex colour like \`#6C80FF\`.`);
			if (user.length > 32) return interaction.editReply("A match must be 32 characters or fewer.");

			const out = await xyro.edit(r => { xyro.set(r, { match: user, label, color }); });
			return interaction.editReply(`Set **${label}** on \`${user}\`. In game within ~15s (revision ${out.rev}).`);
		} catch (err) {
			console.error("nametag command failed:", err);
			const msg = err.code === "conflict"
				? "Someone was publishing at the same time and it kept winning - try that once more."
				: "Failed: " + err.message;
			return interaction.editReply(msg);
		}
	},
};
```

Two details in there that are not optional:

- **Tell the user when it lands.** The script re-fetches every `refreshSeconds`
  (15 s by default), so a tag appears within ~15 s. Saying "done" with no
  timing is what makes staff think the bot did nothing.
- **A rule needs a non-empty `label`.** The script skips a rule whose label is
  empty, so a "match-only" rule silently never applies.

## How `match` actually works

- **Case-insensitive prefix** against the player's username **or** display name.
  `vert` matches `Vertxxy2`, and also `vertex`. Use the full username when you
  can.
- **First rule wins**, in array order.
- `"*"` is the catch-all and belongs **last**. `xyro.set()` inserts a new rule
  *before* it on purpose: a rule appended after the wildcard can never fire, and
  it still shows up in the editor looking correct. If you build the document
  yourself, keep the wildcard at the end.

Your current list ends in `*`, so this applies to you right now.

## Rule fields

```jsonc
{
  "match": "Vertxxy2",        // username, user id, or "*"
  "label": "Vert",            // REQUIRED, non-empty - the text shown
  "color": "#6C80FF",         // label colour
  "badge": true,              // the real Roblox verified seal
  "rank": "developer",        // seal tint: founder (silver) / developer (red) /
                              // hr (white) / support (green) / trial (teal) /
                              // purple / partner (dark blue)
  "image": "https://...",     // avatar-side icon
  "bgImage": "https://...",   // pill background
  "bg": "#0000BD",            // pill colour, when there is no bgImage
  "textColor": "#FFFFFF",     // tag text colour
  "userColor": "#8B92A5",     // the @username line colour
  "bgTransparency": 0.12      // 0 = solid, 1 = invisible
}
```

The **global** look lives in `rules.options` (size, height, fonts, colours,
collapse behaviour, `refreshSeconds`) and is shared by every tag.

## Images: reference them, never embed them

Upload to `media/<sha1-of-content>.<ext>` in the repo (the editor's *Choose
file* does this), then set `image` or `bgImage` to
`https://cdn.jsdelivr.net/gh/vertxxy-1/Xyro@main/media/<name>` - or to your
Worker's `/media/<name>`.

**Do not paste a `data:image/...;base64,...` URI into a rule.** Every client
fetches the rules document on every refresh and re-decodes embedded images in
Lua each time, and base64 also inflates the file by a third. One 1.29 MB
background embedded this way took the rules to 1.72 MB for everybody; moved into
`media/`, the same document is 2.2 KB. If you need to embed anyway, the editor
*Choose file* path does it as a last resort and tells you what it costs.

## Blacklist from the bot

Same key, no database secret, and it works even though the Worker itself has no
Firebase credential:

```js
await xyro.block("1234567890", "ban evasion");  // reason is what they are shown
await xyro.unblock("1234567890");
const list = await xyro.blacklist();            // { "<id or name>": "<reason>" }
```

A blacklisted account gets no UI, tags, presence or command transport, and every
other client stops drawing their tag. Players pick it up on their next launch or
with `!staffrefresh`.

`unblock` reports `ok: false` if the entry also exists in the Firebase staff
node, which the Worker can only edit with a database credential - so you are
never told "unblocked" for an account that is still refused. The detail says
which copy is doing it.

## Kill switch from the bot

`/gate/on`, `/gate/off` and `/announce` are in **api/README.md → the kill
switch**, and `api/gate.js` is a ready CLI for the same thing
(`node api/gate.js off "down for 10 minutes"`). Both use the owner key in
`x-api-key`, exactly like this client. The gate is the one feature that needs a
database credential on the Worker (`FB_SERVICE_ACCOUNT`), because the database
refuses anonymous writes to that node.

## Testing

Offline, no network and no key:

```bash
node Tools/test_nametags_client.js      # 39 checks: the helpers and the race logic
```

Against your live Worker, which also exercises the guarded write path:

```bash
node Tools/test_live_api.js             # 50 checks, read-only
```

Then in game: add a rule with `"match": "<your own username>"`, and run
`!nametagsfetch` for an immediate reload (otherwise it re-checks every
`refreshSeconds`, 15 s by default).
