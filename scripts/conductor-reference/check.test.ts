import { describe, expect, test } from "bun:test";
import type { ReferenceMapping } from "./backend.ts";
import type { SeededState } from "./catalogue.ts";
import { coverage } from "./check.ts";
import type { Inventory } from "./inventory.ts";

const site = { file: "core.js", offset: 1, args: [], reads: null };
const inventory: Inventory = {
	files: ["core.js"],
	wrappers: [],
	commands: [
		{ name: "get_home", sites: [site] },
		{ name: "open_door", sites: [site] },
		{ name: "rpc_send", sites: [site] },
	],
	plugins: {
		sql: [{ name: "select", sites: [site] }],
		event: [{ name: "listen", sites: [site] }],
		window: [{ name: "set_title", sites: [site] }],
	},
	events: [],
	sidecar: [
		{ method: "ping", written: null, direction: "to-sidecar", uses: ["request"], sites: [site] },
		{ method: "pong", written: null, direction: "to-sidecar", uses: ["notify"], sites: [site] },
		{ method: "hello", written: null, direction: "from-sidecar", uses: ["handle"], sites: [site] },
	],
	sql: [],
	dynamic: [],
};

const mapping: ReferenceMapping<SeededState> = {
	route: () => "/",
	databases: () => [],
	boot: () => ({ windowLabel: "main", webviewLabel: "main", globals: {} }),
	commands: { get_home: () => "/Users/sam" },
	tunnel: { command: "rpc_send", lineArg: "line", replyEvent: "rpc_reply" },
	sidecar: { ping: () => "pong" },
};

describe("coverage", () => {
	test("counts built-in, page-kept, tunnel and mapped calls as answered", () => {
		expect(coverage(inventory, mapping)).toEqual({
			commands: { total: 3, answered: ["get_home", "rpc_send"], unanswered: ["open_door"] },
			plugins: {
				total: 3,
				answered: ["plugin:sql|select", "plugin:event|listen"],
				unanswered: ["plugin:window|set_title"],
			},
			sidecar: { total: 2, answered: ["ping"], unanswered: ["pong"] },
		});
	});
});
