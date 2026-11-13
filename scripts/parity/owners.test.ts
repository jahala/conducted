import { describe, expect, test } from "bun:test";
import type { Inventory, Item, MapFile, SpecFile } from "./lib.ts";
import { citedIds, NEIGHBOUR, ownerDrift, owners, rowSites } from "./owners.ts";

const item = (id: string, text: string, research = "ui-map 3"): Item => ({
	id,
	kind: "message",
	item: text,
	research,
	status: "missing",
});

const spec = (inventory: Inventory, entries: [string, string, number][]): SpecFile => ({
	inventory,
	source: "test",
	entries: entries.map(([id, text, offset]) => ({
		id,
		text,
		file: id.includes(":M") ? "main-BE1h_1MP.js" : "renderApp-DeUrsznk.js",
		offset,
	})),
});

// Two rows of label.tsv, both in the spec, and two of toast.tsv, the first of them left out of the
// spec as a logger call. The rows are the spec's entries and the left-out ones, by file and offset.
const sites = rowSites(
	new Map<Inventory, SpecFile>([
		[
			"label",
			spec("label", [
				["label:R100", "Auth", 100],
				["label:R200", "Login method", 200],
			]),
		],
		["toast", spec("toast", [["toast:M400", "Failed", 400]])],
	]),
	[{ inventory: "toast", file: "main-BE1h_1MP.js", offset: 300, rule: "logger" }],
);

const gap = { status: "gap", reason: "missing", screen: "S" } as const;

describe("owners", () => {
	test("a #N citation counts rows from 0 and a toast row from 1", () => {
		expect(citedIds(item("CHAT-28", "x", "inventory label #1"), sites).ids).toEqual(["label:R200"]);
		expect(citedIds(item("CHAT-28", "x", "inventory label #0-1"), sites).ids).toEqual([
			"label:R100",
			"label:R200",
		]);
		expect(citedIds(item("WS-03", "x", "inventory:toast row 2"), sites).ids).toEqual([
			"toast:M400",
		]);
		expect(citedIds(item("SIDE-04", "x", "inventory:rpc cancel"), sites).names).toEqual(["cancel"]);
		expect(citedIds(item("WS-03", "x", "inventory:toast row 1"), sites).ids).toEqual([
			"toast:M300",
		]);
		expect(() => citedIds(item("X-01", "x", "inventory literal #3"), sites)).toThrow(
			"no literal inventory from a TSV",
		);
	});

	test("a citation wins over a quote, a quote over a name, and a hand owner stays", () => {
		const specs = new Map<Inventory, SpecFile>([
			[
				"label",
				spec("label", [
					["label:R100", "Auth", 100],
					["label:R5000", "Save goal", 5000],
					["label:R9000", "Nobody quotes this", 9000],
				]),
			],
			[
				"tauri_command",
				spec("tauri_command", [["tauri_command:R1", "send_native_notification", 1]]),
			],
		]);
		const maps = new Map<Inventory, MapFile>([
			[
				"label",
				{
					"label:R100": gap,
					"label:R5000": gap,
					"label:R9000": { ...gap, backlog: "APP-04", owner: "hand", note: "read by a person" },
				},
			],
			["tauri_command", { "tauri_command:R1": gap }],
		]);
		const items = [
			item("CHAT-08", "Header 'Auth' and 'Save goal'"),
			item("CHAT-28", "Account rows", "inventory label #0"),
			item("PLAT-11", "send_native_notification shows a notification."),
		];
		const next = owners(specs, maps, items, sites);
		expect(next.get("label")?.["label:R100"]).toMatchObject({
			backlog: "CHAT-28",
			item: "Account rows",
			owner: "rule:cite",
		});
		expect(next.get("label")?.["label:R5000"]).toMatchObject({
			backlog: "CHAT-08",
			owner: "rule:quote",
		});
		expect(next.get("label")?.["label:R9000"]).toMatchObject({ backlog: "APP-04", owner: "hand" });
		expect(next.get("tauri_command")?.["tauri_command:R1"]).toMatchObject({
			backlog: "PLAT-11",
			owner: "rule:name",
		});
	});

	test("a neighbour gives a row only when every owned gap nearby has that one row", () => {
		const specs = new Map<Inventory, SpecFile>([
			[
				"text",
				spec("text", [
					["text:R10000", "Owned A", 10_000],
					["text:R10400", "Near A", 10_400],
					["text:R30000", "Owned B", 30_000],
					["text:R30500", "Owned C", 30_500],
					["text:R30200", "Between B and C", 30_200],
					["text:R60000", "Far away", 60_000],
				]),
			],
		]);
		const maps = new Map<Inventory, MapFile>([
			[
				"text",
				Object.fromEntries(
					[
						"text:R10000",
						"text:R10400",
						"text:R30000",
						"text:R30500",
						"text:R30200",
						"text:R60000",
					].map((id) => [id, gap]),
				),
			],
		]);
		const items = [
			item("NAV-03", "'Owned A'"),
			item("NAV-04", "'Owned B'"),
			item("CHAT-01", "'Owned C'"),
		];
		const map = owners(specs, maps, items, sites).get("text") ?? {};
		expect(map["text:R10400"]).toEqual({ ...gap, backlog: "NAV-03", owner: "rule:neighbour" });
		expect(map["text:R30200"]).toEqual(gap);
		expect(map["text:R60000"]).toEqual(gap);
		expect(60_000 - 30_500).toBeGreaterThan(NEIGHBOUR);
	});

	test("drift names each committed entry that differs from what the owners derive", () => {
		const specs = new Map<Inventory, SpecFile>([
			[
				"label",
				spec("label", [
					["label:R100", "Auth", 100],
					["label:R9000", "Far from the cited row", 9000],
				]),
			],
		]);
		const items = [item("CHAT-28", "Account rows", "inventory label #0")];
		const derived = { ...gap, backlog: "CHAT-28", item: "Account rows", owner: "rule:cite" };
		// The same entry with its fields in another order is not drift: the map is compared as data.
		const reordered = { owner: "rule:cite", ...gap, item: "Account rows", backlog: "CHAT-28" };
		const current = new Map<Inventory, MapFile>([
			["label", { "label:R100": reordered, "label:R9000": gap }],
		]);
		expect(ownerDrift(specs, current, items, sites)).toEqual([]);
		const behind = new Map<Inventory, MapFile>([
			["label", { "label:R100": gap, "label:R9000": gap }],
		]);
		expect(ownerDrift(specs, behind, items, sites)).toEqual([
			{ inventory: "label", id: "label:R100", committed: gap, derived },
		]);
	});
});
