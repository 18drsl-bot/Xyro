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

**The tag editor is not exempt from this.** Publishing there needs the owner key
saved in the browser; it used to hold a GitHub token instead and publish to the
repo while reporting `Published`, which is the same trap with a better disguise.
That token is gone: the page has no GitHub credential and no repo write path at
all, so the only way to change what players see is the API. That is why Publish
can decline with "owner key needed to publish" - the browser has no other route
read.

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

## Hosting the bot on Cloudflare

Yes - **if your bot is slash commands and moderation.** No - if it reads chat.

Discord gives you two ways to receive events, and Cloudflare can only host one of
them:

| | Runs on Cloudflare? |
|---|---|
| **HTTP interactions endpoint** - Discord POSTs each slash command, button and modal to a URL you own | **Yes.** Nothing has to stay alive |
| **Gateway** - your process holds a persistent WebSocket and Discord streams every event down it | **No.** Discord deliberately refuses gateway connections from Cloudflare's shared egress addresses, so this is not a configuration problem you can work around |

What that costs you is everything that only exists on the gateway: **message
events** (so no `!prefix` commands, autoresponders or chat logging), member
join/leave, presence, and bot status changes. Slash commands, buttons, select
menus, modals and autocomplete all work.

There is a Worker for it in **`api/bot/`**. It is a separate deployment from the
tag API on purpose, so a bot change can never take the tags down:

```
Discord ──interaction──▶ api/bot (xyro-bot)  ──service──▶ api/worker.js ──▶ rules database
                         verifies the Ed25519   binding   serves GET /nametags
                         signature, ~200ms                PUT /nametags, /blacklist
```

That `service binding` arrow is not a style choice, and getting it wrong is the
one failure on this page that looks like something else entirely - see **Why the
two Workers cannot talk over HTTP** below.

### Setup

Do these in order - the last one only works once the Worker is answering.

**1. Deploy the bot Worker.**

```powershell
cd "$HOME\Downloads\x9k-main\script\Xyro\api\bot"
npx --yes wrangler@latest deploy
```

It prints a URL like `https://xyro-bot.<your-subdomain>.workers.dev`.

`wrangler deploy` also prints a **Bindings** table. One line must be there:

```
Binding                        Resource
env.XYRO_API (xyro-api)        Worker          <- required, and not a secret
```

It comes from `[[services]]` in `api/bot/wrangler.toml`, and it is already in the
file - you only need to look. If that line is missing, the bot cannot reach the
tags at all and every command answers with a `404 error code: 1042`.

**2. Give it your owner key** (the same one from the top of this page):

```powershell
npx --yes wrangler@latest secret put XYRO_ADMIN_KEY    # paste at the prompt
```

**3. Register the slash commands** - from your machine, not the Worker, because
this is the one thing that needs the bot **token**:

```powershell
$env:DISCORD_TOKEN = "your-bot-token"
$env:DISCORD_APPLICATION_ID = "your-application-id"
$env:DISCORD_GUILD_ID = "your-test-server-id"   # optional; guild commands appear instantly
node api/bot/register-commands.js
```

**4. Give it the bot's Public Key.** Developer Portal → your app → General
Information → **Public Key**:

```powershell
npx --yes wrangler@latest secret put DISCORD_PUBLIC_KEY    # paste at the prompt
```

It is public by design - it verifies signatures and cannot be used to
impersonate anyone.

**This must come before step 5, not after.** Without it the Worker cannot verify
anything, so it answers `401` to everything, including the validation `PING`
Discord sends when you try to save the URL - and the portal then says the
endpoint could not be verified, which looks like a Worker problem and is really
a missing secret.

**5. Set the Interactions Endpoint URL.** Developer Portal → your app → General
Information → **Interactions Endpoint URL** → the Worker URL from step 1.

Discord immediately sends a signed `PING` and **refuses to save the URL** unless
the Worker answers it correctly. If that save fails, watch what actually arrives:

```powershell
cd "$HOME\Downloads\x9k-main\script\Xyro\api\bot"
npx --yes wrangler@latest tail
```

Every request is logged. A `401` means the public key does not match the app you
are configuring; a `405` means you set a different URL (only `POST` is accepted).

### Why the two Workers cannot talk over HTTP

This is worth reading once, because it is the mistake that costs an hour.

A Cloudflare Worker may not `fetch()` another Worker **on the same zone** using
its public URL. Cloudflare refuses it with error **1042**, and what reaches the
bot is an opaque `404 error code: 1042` - which reads like the Xyro API is
missing, or the route is wrong, or the key is bad. It is none of those.

Both Workers here live on one `*.workers.dev` subdomain, so that path never
worked. The supported route is a **service binding**:

```toml
[[services]]
binding = "XYRO_API"      # what the code calls it
service = "xyro-api"      # `name` from ../wrangler.toml
```

It goes straight into the other Worker inside your account - no DNS, no
same-zone restriction, still one hop on Cloudflare's network, and it needs no
credential of its own. `api/bot/bot-worker.js` prefers the binding and falls
back to `XYRO_API_URL` only when there is no binding (a local `wrangler dev`, or
two Workers on genuinely different zones).

`XYRO_API_URL` is still in `wrangler.toml` as that fallback. Leaving it set is
fine; **relying** on it is what returns 1042.

### Keeping the bot online (the green dot)

**A Worker-hosted bot is always offline, and no portal setting changes that.**
The Worker only wakes when Discord POSTs an interaction; between commands there
is no process and no socket, so the member list shows the bot grey. Every slash
command still works perfectly. If the grey dot bothers you, that is a separate,
small program:

```bash
node api/bot/presence.js
```

It opens the gateway, sends `IDENTIFY` once (with the presence inside it, so the
dot is green on the first frame), heartbeats every ~41s, and does nothing else.
It never touches your tag rules - setting the Interactions Endpoint URL routes
every command to the Worker whether or not a gateway session exists, so both run
at once:

```
Discord --interactions--> xyro-bot Worker --> tags API     (commands)
Discord --gateway-------> presence.js                      (presence only)
```

Token: `DISCORD_TOKEN`, or write it to `api/bot/.discord-token` (gitignored).
Status and activity are optional:

```powershell
$env:DISCORD_TOKEN = "your-bot-token"
$env:DISCORD_STATUS = "online"            # online | idle | dnd | invisible
$env:DISCORD_ACTIVITY = "Managing tags"
$env:DISCORD_ACTIVITY_TYPE = "watching"   # playing | streaming | listening | watching | competing | custom
node api/bot/presence.js
```

**It needs an always-on host, and your PC is not one.** Run it from a laptop and
the bot is online exactly as long as the laptop is. Anywhere Node 22+ runs is
fine and costs nothing to try: a spare machine, a Raspberry Pi, or a free tier
on Fly.io / Railway / Render. **Do not deploy it to Cloudflare Workers** - it is
precisely the thing Workers cannot do, because Discord refuses gateway
connections from Cloudflare's egress addresses.

What it does *not* give you: chat commands, join messages, or anything else that
only exists on the gateway. It is a presence keeper. If you want those, the whole
bot has to move to a gateway host - and then the Worker becomes optional, because
it can answer interactions too.

Its failure modes are the quiet kind, so they are worth naming: a session that
stops being ACKed is a *zombie* (open socket, no traffic, bot silently grey), so
the keeper reconnects on a missed heartbeat; a bad token closes with `4004` and
the keeper stops and says so instead of retrying forever; and reconnects use
bounded backoff with jitter, because a fixed retry interval is itself something
Discord closes sessions for. All of that is tested - see below.

### Things worth knowing before you move your bot here

**The 3-second deadline is why the bot answers inline.** Discord requires the
initial response within 3 seconds, and a deferred reply needs a *second* call to
Discord's API from the Worker. This bot never makes that second call: it reads
and publishes the tags (a Worker-to-Worker hop, ~200ms) and answers in the same
request. That is also what keeps it clear of the one real Cloudflare caveat:
Discord rate-limits Cloudflare's shared egress addresses, which has produced
`429` and Cloudflare error `1015` for Workers calling `discord.com/api` from some
regions (see discord-api-docs issue #7146). Registering commands is unaffected
because you run it locally, not from the Worker.

**You cannot fetch Discord attachments.** The official Cloudflare tutorial notes
that Workers get a `403` for non-ephemeral `cdn.discordapp.com` media. Only
relevant if you wanted to read an uploaded image.

**Lock it to your server.** Set `DISCORD_GUILD_ID` in `api/bot/wrangler.toml`
(and re-deploy), or anyone who installs your bot in their own server gets these
commands. The Manage Roles check still applies - their admins would pass it.

**Never send a message as your bot from the Worker.** The bot token would let
any request path post as your bot, which is why it only exists in
`register-commands.js`, on your machine. The Worker holds the *public* key and
your owner key and nothing else.

**Test it offline first.** `node Tools/test_bot_worker.js` generates a real
Ed25519 keypair, signs payloads the way Discord does, and drives the Worker's
own verify path - including the cases that matter: a tampered body, a replayed
timestamp, the wrong key, and a member without Manage Roles. 58 checks, no
network, no Cloudflare account.

**Then test it live.** `node Tools/test_bot_live.js` checks the endpoint you
actually deployed: that an unsigned or forged request is refused, that a `GET` is
`405`, and that a signed `PING` is answered. Add `--selftest` to sign for real -
it installs a throwaway public key, drives the full command path (which is what
proves the service binding works), and then **tells you to put your real key
back**, because until you do, Discord's own validation is refused.

### What you need from the Developer Portal

| | Where |
|---|---|
| Public Key | General Information → Public Key (a Worker secret) |
| Application ID | General Information → Application ID (for registering) |
| Bot Token | Bot → Reset Token (local only, never on the Worker) |
| Interactions Endpoint URL | General Information → set it to the Worker URL |
| Install link | OAuth2 → URL Generator → `bot` + `applications.commands` |

Still prefer a normal always-on host? Everything on this page works unchanged
there - the bot just needs to reach your Worker, and `api/nametags-client.js` is
the Node client for it. On a gateway host you also get chat commands and join
messages, which the Worker cannot give you, and `api/bot/presence.js` is then
unnecessary.

## Testing

Offline, no network and no key:

```bash
node Tools/test_nametags_client.js      # 39 checks: the helpers and the race logic
node Tools/test_presence.js             # 64 checks: the gateway protocol, over a fake socket
```

Against your live Worker, which also exercises the guarded write path:

```bash
node Tools/test_live_api.js             # 50 checks, read-only
```

Against the deployed **bot** endpoint - always runnable, then signed for real:

```bash
node Tools/test_bot_live.js             # 4 checks: deployed, guarded, 405/401
node Tools/test_bot_live.js --selftest  # 9 checks: signs like Discord does
```

`--selftest` installs a throwaway `DISCORD_PUBLIC_KEY` and prints the command to
put your real one back. Do not leave the throwaway in place.

Then in game: add a rule with `"match": "<your own username>"`, and run
`!nametagsfetch` for an immediate reload (otherwise it re-checks every
`refreshSeconds`, 15 s by default).
