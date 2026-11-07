import { describe, expect, test } from "bun:test";
import {
	accountedFor,
	checkBackend,
	checkCompleteness,
	checkLayout,
	checkText,
	type Inputs,
	isSample,
	sampleLines,
	squash,
	templatePattern,
} from "./checks.ts";
import type { LayoutSpec } from "./dump.ts";
import type { BackendInventory, Dump, DumpState, Inventory, MapFile, SpecFile } from "./lib.ts";

const spec = (inventory: Inventory, entries: [string, string][]): SpecFile => ({
	inventory,
	source: "test",
	entries: entries.map(([id, text], index) => ({
		id,
		text,
		file: "renderApp-DeUrsznk.js",
		offset: index,
	})),
});

function inputs(overrides: Partial<Inputs> = {}): Inputs {
	return {
		specs: new Map([
			[
				"label",
				spec("label", [
					["label:R1", "Add project"],
					["label:R2", "Search models"],
					["label:R3", "Invite teammates"],
					["label:R4", "Never mapped"],
				]),
			],
		]),
		maps: new Map<Inventory, MapFile>([
			[
				"label",
				{
					"label:R1": { status: "matched", state: "sidebar", by: "seed" },
					"label:R2": { status: "matched", state: "composer-model-picker", by: "hand" },
					"label:R3": { status: "decided", decision: "D004", note: "team feature", by: "hand" },
				},
			],
		]),
		decisions: new Set(["D004"]),
		items: new Map([["PRJ-01", new Set(["Add a project from a folder"])]]),
		states: new Set(["sidebar", "composer-model-picker"]),
		oursOnly: [],
		strayMaps: [],
		templates: ["{} tool calls, {} messages"],
		screenFor: () => "ui-map 4. Left sidebar",
		...overrides,
	};
}

const state = (id: string, names: [string, DumpState["names"][number]["via"]][]): DumpState => ({
	id,
	group: `Group of ${id}`,
	route: "/",
	error: null,
	names: names.map(([text, via]) => ({ text, via, role: "button", selector: "button" })),
	layout: [],
});

const dumpOf = (states: DumpState[], sample: string[] = []): Dump => ({
	commit: "test",
	viewport: { width: 1440, height: 900 },
	sample,
	states,
});

describe("check a, map completeness", () => {
	test("an unmapped entry is a gap with its screen; mapped and decided entries pass", () => {
		const findings = checkCompleteness(inputs());
		expect(findings.map((f) => [f.code, f.id, f.severity, f.screen])).toEqual([
			["unmapped", "label:R4", "gap", "ui-map 4. Left sidebar"],
		]);
	});

	test("a gap carries its class: unshown and missing by reason, wording when a person says so", () => {
		const maps = new Map<Inventory, MapFile>([
			[
				"label",
				{
					"label:R1": { status: "gap", reason: "unshown", screen: "S" },
					"label:R2": { status: "gap", reason: "missing", screen: "S", backlog: "SET-01" },
					"label:R3": { status: "gap", reason: "missing", screen: "S", class: "wording" },
					"label:R4": { status: "matched", state: "sidebar", by: "seed" },
				},
			],
		]);
		const found = checkCompleteness(inputs({ maps }));
		const classOf = (id: string) => found.find((finding) => finding.id === id);
		expect(classOf("label:R1")).toMatchObject({ code: "gap-unshown", class: "unshown" });
		expect(classOf("label:R2")).toMatchObject({ class: "feature", backlog: "SET-01" });
		expect(classOf("label:R3")).toMatchObject({ code: "gap-missing", class: "wording" });
	});

	test("an unknown decision, an unknown state and a map id with no spec entry are broken", () => {
		const maps = new Map<Inventory, MapFile>([
			[
				"label",
				{
					"label:R1": { status: "matched", state: "no-such-state", by: "seed" },
					"label:R2": { status: "matched", state: "sidebar", by: "seed" },
					"label:R3": { status: "decided", decision: "D999", note: "?", by: "hand" },
					"label:R4": { status: "gap", reason: "missing", screen: "Sidebar" },
					"label:R9": { status: "gap", reason: "missing", screen: "Sidebar" },
				},
			],
		]);
		const codes = checkCompleteness(inputs({ maps }))
			.filter((f) => f.severity === "broken")
			.map((f) => f.code)
			.sort();
		expect(codes).toEqual(["unknown-decision", "unknown-id", "unknown-state"]);
	});

	test("a gap's owner must name a backlog row, and an item that row holds", () => {
		const gap = { status: "gap", reason: "missing", screen: "S" } as const;
		const owners = (entry: MapFile[string]) =>
			checkCompleteness(
				inputs({
					maps: new Map<Inventory, MapFile>([["label", { "label:R4": entry }]]),
				}),
			).filter((finding) => finding.id === "label:R4");
		const owned = owners({ ...gap, backlog: "PRJ-01", item: "Add a project from a folder" });
		expect(owned.map((finding) => finding.severity)).toEqual(["gap"]);
		expect(owned[0]).toMatchObject({ backlog: "PRJ-01", item: "Add a project from a folder" });
		expect(owners({ ...gap, backlog: "PRJ-01" }).map((finding) => finding.severity)).toEqual([
			"gap",
		]);
		for (const wrong of [
			{ ...gap, backlog: "PRJ-99" },
			{ ...gap, backlog: "PRJ-01", item: "Something no item says" },
			{ ...gap, item: "Add a project from a folder" },
		]) {
			expect(owners(wrong).map((finding) => finding.code)).toEqual([
				"gap-missing",
				"unknown-owner",
			]);
		}
	});

	test("an ours-only entry with neither a decision nor the owner's keep ruling is broken", () => {
		const findings = checkCompleteness(
			inputs({ oursOnly: [{ text: "Copy summary", note: "ours" }] }),
		);
		expect(
			findings.some((f) => f.code === "ours-only-unsupported" && f.severity === "broken"),
		).toBe(true);
	});
});

describe("check b, text and controls both ways", () => {
	test("a matched entry missing from its state is a gap; present by any name is not", () => {
		const dump = dumpOf([
			state("sidebar", [["Add project", "aria-label"]]),
			state("composer-model-picker", [["Opus", "text"]]),
		]);
		const missing = checkText(inputs(), dump).filter((f) => f.code === "missing-in-state");
		expect(missing.map((f) => [f.id, f.state])).toEqual([["label:R2", "composer-model-picker"]]);
	});

	test("a string of ours is flagged unless matched, sample data, formatted or kept", () => {
		const dump = dumpOf(
			[
				state("sidebar", [
					["Add project", "text"],
					["Add a project", "text"],
					["sam/rate-limit-api", "text"],
					["+36 -1", "text"],
					["52s · 9:15 AM", "text"],
					["Copy summary", "text"],
					["3 tool calls, 2 messages", "text"],
					["src/auth sign-in.ts", "text"],
					["just now", "text"],
				]),
				state("composer-model-picker", [["Search models", "placeholder"]]),
			],
			["sam/rate-limit-api", "src/auth/sign-in.ts"],
		);
		const kept = inputs({
			oursOnly: [{ text: "Copy summary", decision: "D004", note: "kept as ours" }],
		});
		const oursOnly = checkText(kept, dump).filter((f) => f.code === "ours-only");
		expect(oursOnly.map((f) => [f.state, f.text])).toEqual([["sidebar", "Add a project"]]);
	});

	test("a state that failed is one broken finding and its entries are not also missing", () => {
		const failed = { ...state("sidebar", []), error: "The screen never settled" };
		const findings = checkText(
			inputs(),
			dumpOf([failed, state("composer-model-picker", [["Search models", "text"]])]),
		);
		expect(findings.map((f) => [f.code, f.severity])).toEqual([["state-failed", "broken"]]);
	});

	test("a line of a multi-line sample is sample data; a one-word line is not", () => {
		const reply = "## The test fix\n\n- One test called \\`url.parse\\`\nDone\n  try {\n${value}";
		expect(sampleLines(reply)).toEqual(["The test fix", "One test called `url.parse`", "try {"]);
	});

	test("an environment variable's name is an identifier, not wording", () => {
		const dump = dumpOf([
			state("sidebar", [
				["ANTHROPIC_API_KEY", "text"],
				["TOKEN", "text"],
			]),
		]);
		const ours = checkText(inputs(), dump).filter((finding) => finding.code === "ours-only");
		expect(ours.map((finding) => finding.text)).toEqual(["TOKEN"]);
	});

	test("a template must match the whole name, and a sample piece needs four letters or digits", () => {
		expect(templatePattern("{} tool calls, {} messages").test("6 tool calls, 4 messages")).toBe(
			true,
		);
		expect(templatePattern("{} tool calls").test("6 tool calls hidden")).toBe(false);
		expect(templatePattern("Open (beta) {}").test("Open (beta) x")).toBe(true);
		expect(isSample("docs redirects.md", [squash("docs/redirects.md")])).toBe(true);
		expect(isSample("Write something ...", [squash("Write a test first")])).toBe(false);
		expect(isSample("ok", [squash("ok then")])).toBe(false);
		expect(isSample("Sidebar", [squash("Sidebar: two projects")])).toBe(false);
		expect(
			isSample("safeNext accepts only paths", [squash("`safeNext` accepts only paths here")]),
		).toBe(true);
	});

	test("accountedFor leaves nothing with two letters once sample and formatting go", () => {
		expect(accountedFor("arbor · 2 files", ["arbor", "files"])).toBe(true);
		expect(accountedFor("Write something ...", ["something else"])).toBe(false);
		expect(accountedFor("Opus High", ["Opus", "High"])).toBe(true);
	});
});

describe("check c, layout", () => {
	const layout: LayoutSpec = {
		tolerance: { style: 0.5, box: 1, weight: 0 },
		entries: [
			{
				id: "tool-call-row",
				what: "row",
				evidence: "ui-dimensions.md 5",
				state: "chat-working",
				locator: { css: "button" },
				expect: { "padding-top": 6, height: 32, "font-weight": 450 },
			},
		],
	};
	const reading = (values: Record<string, number>, found = true): Dump =>
		dumpOf([{ ...state("chat-working", []), layout: [{ id: "tool-call-row", found, values }] }]);

	test("values inside the tolerance pass", () => {
		expect(
			checkLayout(layout, reading({ "padding-top": 6.4, height: 32.9, "font-weight": 450 })),
		).toEqual([]);
	});

	test("a value outside the tolerance, a weight off by one step and a missing element are gaps", () => {
		const off = checkLayout(layout, reading({ "padding-top": 0, height: 36, "font-weight": 500 }));
		expect(off.map((f) => f.code)).toEqual(["layout-off"]);
		expect(off[0]?.detail).toContain("padding-top 0 (Conductor 6)");
		expect(off[0]?.detail).toContain("height 36 (Conductor 32)");
		expect(off[0]?.detail).toContain("font-weight 500 (Conductor 450)");
		expect(checkLayout(layout, reading({}, false)).map((f) => f.code)).toEqual([
			"layout-not-found",
		]);
		expect(checkLayout(layout, dumpOf([])).map((f) => f.code)).toEqual(["layout-state-missing"]);
	});
});

describe("check e, backend lists", () => {
	const ours = (
		overrides: Partial<Record<BackendInventory, string[]>>,
	): Record<BackendInventory, string[]> => ({
		sidecar_rpc_method: [],
		sidecar_call: [],
		sidecar_tool_name: [],
		tauri_command: [],
		tauri_plugin_command: [],
		tauri_event: [],
		settings_key: [],
		table: [],
		...overrides,
	});

	test("a matched name we no longer have and a name of ours nobody matched are gaps", () => {
		const base = inputs({
			specs: new Map([
				[
					"table",
					spec("table", [
						["table:repos", "repos"],
						["table:sessions", "sessions"],
					]),
				],
			]),
			maps: new Map<Inventory, MapFile>([
				[
					"table",
					{
						"table:repos": { status: "matched", ours: "repos", by: "seed" },
						"table:sessions": { status: "matched", ours: "sessions", by: "seed" },
					},
				],
			]),
		});
		const findings = checkBackend(base, ours({ table: ["repos", "backlog_workspaces"] }));
		expect(findings.map((f) => [f.code, f.text])).toEqual([
			["backend-missing", "sessions"],
			["backend-ours-only", "backlog_workspaces"],
		]);
		const kept = {
			...base,
			oursOnly: [
				{ text: "backlog_workspaces", inventory: "table" as const, decision: "D004", note: "ours" },
			],
		};
		expect(
			checkBackend(kept, ours({ table: ["repos", "sessions", "backlog_workspaces"] })),
		).toEqual([]);
	});
});
