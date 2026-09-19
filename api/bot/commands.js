/**
 * commands.js - the slash commands this bot registers, as plain JSON.
 *
 * One source of truth: register-commands.js sends these to Discord, and
 * Tools/test_bot_worker.js asserts that every command named here is actually
 * routed by bot-worker.js. A command that is registered but not routed is the
 * worst of both worlds - it appears in Discord, users pick it, and it answers
 * "Unknown command".
 *
 * Option types: 1 SUB_COMMAND, 3 STRING, 5 BOOLEAN.
 * Permission bits: MANAGE_ROLES = 1 << 28 = 268435456.
 */
const MANAGE_ROLES = "268435456";

export const COMMANDS = [
	{
		name: "nametag",
		description: "Manage Xyro nametags",
		// hides the command from everyone without Manage Roles. It is a UI hint
		// only - the Worker enforces the same permission on every request,
		// because a hidden command can still be invoked by a crafted interaction.
		default_member_permissions: MANAGE_ROLES,
		options: [
			{
				type: 1,
				name: "set",
				description: "Give someone a tag",
				options: [
					{ type: 3, name: "user", description: "Roblox username or user id", required: true },
					{ type: 3, name: "label", description: "The text the tag shows", required: true },
					{ type: 3, name: "color", description: "Hex colour, e.g. #6C80FF", required: false },
					{ type: 5, name: "badge", description: "Show the Roblox verified seal", required: false },
				],
			},
			{
				type: 1,
				name: "remove",
				description: "Take someone's tag away",
				options: [{ type: 3, name: "user", description: "Roblox username or user id", required: true }],
			},
			{
				type: 1,
				name: "list",
				description: "Show every published tag",
				options: [],
			},
		],
	},
	{
		name: "block",
		description: "Stop the Xyro script from running for someone",
		default_member_permissions: MANAGE_ROLES,
		options: [
			{ type: 3, name: "who", description: "Roblox username or user id", required: true },
			{ type: 3, name: "reason", description: "What they are shown when it refuses to load", required: false },
		],
	},
	{
		name: "unblock",
		description: "Let a blocked account run the script again",
		default_member_permissions: MANAGE_ROLES,
		options: [{ type: 3, name: "who", description: "Roblox username or user id", required: true }],
	},
];

/** Every command name, for the routing check in the test suite. */
export const COMMAND_NAMES = COMMANDS.map(c => c.name);

/** Every `<command> <subcommand>` pair, flattened. */
export const ROUTES = COMMANDS.flatMap(c =>
	(c.options || []).some(o => o.type === 1)
		? (c.options || []).filter(o => o.type === 1).map(sub => c.name + " " + sub.name)
		: [c.name]
);
