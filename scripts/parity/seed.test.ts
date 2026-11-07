import { describe, expect, test } from "bun:test";
import type { BackendInventory, Dump, Inventory, MapFile, SpecFile } from "./lib.ts";
import { seedMaps } from "./seed.ts";

const noBackend: Record<BackendInventory, string[]> = {
	sidecar_rpc_method: [],
	sidecar_call: [],
	sidecar_tool_name: [],
	tauri_command: ["workspace_open"],
	tauri_plugin_command: ["sql|*"],
	tauri_event: [],
	settings_key: [],
	table: [],
};

const dump: Dump = {
	commit: "test",
	viewport: { width: 1440, height: 900 },
	sample: [],
	states: [
		{
			id: "sidebar",
			group: "App shell",
			route: "/",
			error: null,
			names: [
				{ text: "Add project", via: "aria-label", role: "button", selector: "nav > button" },
				{ text: "No matching workspaces.", via: "text", role: "p", selector: "p" },
			],
			layout: [],
		},
		{
			id: "home",
			group: "Home",
			route: "/all-workspaces",
			error: null,
			names: [{ text: "Add project", via: "text", role: "button", selector: "main button" }],
			layout: [],
		},
	],
};

const label = (entries: [string, string][]): SpecFile => ({
	inventory: "label",
	source: "test",
	entries: entries.map(([id, text], index) => ({
		id,
		text,
		file: "renderApp-DeUrsznk.js",
		offset: index,
	})),
});

function seed(specs: Map<Inventory, SpecFile>, maps: Map<Inventory, MapFile> = new Map()) {
	return seedMaps({
		specs,
		maps,
		dump,
		ours: noBackend,
		ourStrings: new Set(["Open draft"]),
		screenFor: () => "ui-map 4. Left sidebar",
		rules: { places: new Set(["Lisbon"]) },
	});
}

describe("seeding the map from a dump", () => {
	test("exact text is matched in the first state that shows it; loose text is unsure", () => {
		const map = seed(
			new Map([
				[
					"label",
					label([
						["label:R1", "Add project"],
						["label:R2", "No matching workspaces"],
					]),
				],
			]),
		).get("label");
		expect(map?.["label:R1"]).toEqual({
			status: "matched",
			state: "sidebar",
			via: "aria-label",
			role: "button",
			selector: "nav > button",
			by: "seed",
		});
		expect(map?.["label:R2"]).toMatchObject({
			status: "matched",
			state: "sidebar",
			by: "seed-unsure",
		});
	});

	test("an entry nobody shows is a gap: unshown when our source has it, missing when not", () => {
		const map = seed(
			new Map([
				[
					"label",
					label([
						["label:R1", "Open draft"],
						// Not a team string: the team-wording rule would decide that one.
						["label:R2", "Merge stack"],
					]),
				],
			]),
		).get("label");
		expect(map?.["label:R1"]).toEqual({
			status: "gap",
			reason: "unshown",
			screen: "ui-map 4. Left sidebar",
		});
		expect(map?.["label:R2"]).toMatchObject({ status: "gap", reason: "missing" });
	});

	test("a hand entry and a decision are kept; a rule writes its decision", () => {
		const specs = new Map<Inventory, SpecFile>([
			[
				"label",
				label([
					["label:R1", "Add project"],
					["label:R2", "Invite teammates"],
				]),
			],
			["literal", { ...label([["literal:R3", "Lisbon"]]), inventory: "literal" }],
		]);
		const maps = new Map<Inventory, MapFile>([
			[
				"label",
				{
					"label:R1": { status: "matched", state: "home", by: "hand" },
					"label:R2": { status: "decided", decision: "D004", note: "team", by: "hand" },
				},
			],
		]);
		const seeded = seed(specs, maps);
		expect(seeded.get("label")?.["label:R1"]).toEqual({
			status: "matched",
			state: "home",
			by: "hand",
		});
		expect(seeded.get("label")?.["label:R2"]).toMatchObject({
			status: "decided",
			decision: "D004",
		});
		expect(seeded.get("literal")?.["literal:R3"]).toMatchObject({
			status: "decided",
			decision: "D086",
			by: "rule:place-name",
		});
	});

	test("a team, service or asset entry is decided by its rule; another organisation is not", () => {
		const specs = new Map<Inventory, SpecFile>([
			[
				"label",
				label([
					["label:R1", "Create organization"],
					["label:R2", "Manage your Conductor Pro plan and payment details."],
					["label:R3", "Organization"],
					["label:R4", "Associates Codex API requests with an OpenAI organization."],
				]),
			],
			[
				"route",
				{
					...label([
						["route:R5", "/chime.mp3"],
						["route:R6", "/settings/organization/prompts"],
					]),
					inventory: "route",
				},
			],
		]);
		const seeded = seed(specs);
		expect(seeded.get("label")?.["label:R1"]).toMatchObject({
			decision: "D004",
			by: "rule:team-wording",
		});
		expect(seeded.get("label")?.["label:R2"]).toMatchObject({
			decision: "D025",
			by: "rule:conductor-service",
		});
		expect(seeded.get("label")?.["label:R3"]).toMatchObject({ status: "gap" });
		expect(seeded.get("label")?.["label:R4"]).toMatchObject({ status: "gap" });
		expect(seeded.get("route")?.["route:R5"]).toMatchObject({ by: "rule:bundled-asset" });
		expect(seeded.get("route")?.["route:R6"]).toMatchObject({ by: "rule:team-route" });
	});

	test("a gap that stays a gap keeps its class and owner; one that matches drops them", () => {
		const specs = new Map<Inventory, SpecFile>([
			[
				"label",
				label([
					["label:R1", "Merge stack"],
					["label:R2", "Add project"],
				]),
			],
		]);
		const sorted = {
			status: "gap",
			reason: "missing",
			screen: "S",
			class: "wording",
			backlog: "PR-08",
			item: "Merge the whole stack",
			owner: "hand",
			note: "ours says Merge all",
		} as const;
		const maps = new Map<Inventory, MapFile>([
			["label", { "label:R1": sorted, "label:R2": { ...sorted, backlog: "PRJ-01" } }],
		]);
		const seeded = seed(specs, maps).get("label");
		expect(seeded?.["label:R1"]).toMatchObject({
			class: "wording",
			backlog: "PR-08",
			item: "Merge the whole stack",
			owner: "hand",
			note: "ours says Merge all",
		});
		expect(seeded?.["label:R2"]).toMatchObject({ status: "matched", by: "seed" });
		expect(seeded?.["label:R2"]).not.toHaveProperty("backlog");
		expect(seeded?.["label:R2"]).not.toHaveProperty("item");
	});

	test("Conductor's name for itself matches ours", () => {
		const specs = new Map<Inventory, SpecFile>([
			["label", label([["label:R1", "Review, comment, and merge from Conductor."]])],
		]);
		const named: Dump = {
			...dump,
			states: [
				{
					id: "onboarding",
					group: "App shell",
					route: "/",
					error: null,
					layout: [],
					names: [
						{
							text: "Review, comment, and merge from Conducted.",
							via: "text",
							role: "span",
							selector: "li span",
						},
					],
				},
			],
		};
		const seeded = seedMaps({
			specs,
			maps: new Map(),
			dump: named,
			ours: noBackend,
			ourStrings: new Set(),
			screenFor: () => "x",
			rules: { places: new Set() },
		});
		expect(seeded.get("label")?.["label:R1"]).toMatchObject({ status: "matched", by: "seed" });
	});

	test("backend names match ours by name, and a plugin command by its plugin", () => {
		const specs = new Map<Inventory, SpecFile>([
			[
				"tauri_command",
				{
					inventory: "tauri_command",
					source: "t",
					entries: [
						{ id: "tauri_command:workspace_open", text: "workspace_open", file: "M", offset: 1 },
					],
				},
			],
			[
				"tauri_plugin_command",
				{
					inventory: "tauri_plugin_command",
					source: "t",
					entries: [
						{ id: "p:sql|execute", text: "sql|execute", file: "M", offset: 2 },
						{ id: "p:os|platform", text: "os|platform", file: "M", offset: 3 },
					],
				},
			],
		]);
		const seeded = seed(specs);
		expect(seeded.get("tauri_command")?.["tauri_command:workspace_open"]).toEqual({
			status: "matched",
			ours: "workspace_open",
			by: "seed",
		});
		expect(seeded.get("tauri_plugin_command")?.["p:sql|execute"]).toMatchObject({ ours: "sql|*" });
		expect(seeded.get("tauri_plugin_command")?.["p:os|platform"]).toEqual({
			status: "gap",
			reason: "missing",
			screen: "Backend",
		});
	});
});
