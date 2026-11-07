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
						["label:R2", "Invite teammates"],
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
