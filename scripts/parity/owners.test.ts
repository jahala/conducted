import { describe, expect, test } from "bun:test";
import type { Inventory, Item, MapFile, SpecFile } from "./lib.ts";
import { citedIds, NEIGHBOUR, owners, rowSites } from "./owners.ts";

const item = (id: string, text: string, research = "ui-map 3"): Item => ({
	id,
	kind: "message",
	item: text,
	research,
	status: "missing",
});

// Two data rows of label.tsv and toast.tsv, in the inventories' own columns.
const TSV: Record<string, string> = {
	label:
		"kind\ttext\tfile\toffset\tcontext\nlabel\tAuth\trenderApp-DeUrsznk.js\t100\tx\nlabel\tLogin method\trenderApp-DeUrsznk.js\t200\tx\n",
	toast:
		"kind\ttext\tfile\toffset\tcontext\ntoast\tSaved\tmain-BE1h_1MP.js\t300\tx\ntoast\tFailed\tmain-BE1h_1MP.js\t400\tx\n",
};
const sites = rowSites((kind) => {
	const tsv = TSV[kind];
	if (tsv === undefined) throw new Error(`no ${kind}.tsv`);
	return tsv;
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
		expect(() => citedIds(item("X-01", "x", "inventory title #3"), sites)).toThrow("no title.tsv");
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
});
