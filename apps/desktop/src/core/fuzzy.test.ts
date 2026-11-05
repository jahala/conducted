import { describe, expect, it } from "vitest";
import { type FuzzyField, fuzzyMatch, rankFuzzy } from "./fuzzy.ts";

describe("APP-15 fuzzyMatch", () => {
	it("matches a query as a subsequence and reports the matched ranges", () => {
		expect(fuzzyMatch("zom", "Code theme")).toBeNull();
		const candidate = "App zoom";
		const match = fuzzyMatch("zom", candidate);
		expect(match).not.toBeNull();
		const ranges = match?.ranges ?? [];
		expect(ranges.map((range) => candidate.slice(range.start, range.end)).join("")).toBe("zom");
	});

	it("ignores case", () => {
		expect(fuzzyMatch("ZOM", "App zoom")).not.toBeNull();
		expect(fuzzyMatch("APP", "app settings")?.ranges).toEqual([{ start: 0, end: 3 }]);
	});

	it("ignores accents", () => {
		expect(fuzzyMatch("cafe", "Café menu")?.ranges).toEqual([{ start: 0, end: 4 }]);
		expect(fuzzyMatch("e", "é")?.ranges).toEqual([{ start: 0, end: 1 }]);
	});

	it("requires every word to match somewhere, in any order", () => {
		expect(fuzzyMatch("zoom app", "App zoom")).not.toBeNull();
		expect(fuzzyMatch("app zzz", "App zoom")).toBeNull();
	});

	it("rejects letters out of order", () => {
		expect(fuzzyMatch("mz", "App zoom")).toBeNull();
	});

	it("handles an empty candidate and a blank query", () => {
		expect(fuzzyMatch("a", "")).toBeNull();
		expect(fuzzyMatch("   ", "App zoom")).toEqual({ score: 0, ranges: [] });
		expect(fuzzyMatch("", "")).toEqual({ score: 0, ranges: [] });
	});

	it("scores a prefix, a word start, an exact run and a short text higher", () => {
		const prefix = fuzzyMatch("app", "App settings");
		const inside = fuzzyMatch("app", "xapp settings");
		expect(prefix?.score).toBeGreaterThan(inside?.score ?? 0);

		const run = fuzzyMatch("app", "axpp settings");
		const split = fuzzyMatch("app", "axpxp settings");
		expect(run?.score).toBeGreaterThan(split?.score ?? 0);

		const short = fuzzyMatch("app", "App");
		expect(short?.score).toBeGreaterThan(prefix?.score ?? 0);
	});

	it("scores a word start and a camelCase boundary higher", () => {
		const wordStart = fuzzyMatch("app", "x app");
		const glued = fuzzyMatch("app", "xapp");
		expect(wordStart).not.toBeNull();
		expect(glued).not.toBeNull();
		expect(wordStart?.score).toBeGreaterThan(glued?.score ?? 0);

		const camel = fuzzyMatch("ba", "fooBar");
		const lower = fuzzyMatch("ba", "foobar");
		expect(camel).not.toBeNull();
		expect(lower).not.toBeNull();
		expect(camel?.score).toBeGreaterThan(lower?.score ?? 0);
	});

	it("lets two query words claim the same letters", () => {
		expect(fuzzyMatch("app app", "App")).not.toBeNull();
	});

	it("keeps ranges valid for characters outside the basic plane", () => {
		const candidate = "😀 App";
		const match = fuzzyMatch("app", candidate);
		expect(match?.ranges).toEqual([{ start: 3, end: 6 }]);
		const start = match?.ranges[0]?.start ?? 0;
		const end = match?.ranges[0]?.end ?? 0;
		expect(candidate.slice(start, end)).toBe("App");

		expect(fuzzyMatch("😀", "x😀y")?.ranges).toEqual([{ start: 1, end: 3 }]);
	});

	it("treats regular-expression symbols as plain text", () => {
		expect(fuzzyMatch("a.", "x a. y")).not.toBeNull();
		expect(fuzzyMatch("a.", "x ab y")).toBeNull();
		expect(fuzzyMatch("(beta)", "App (beta)")).not.toBeNull();
	});
});

interface Row {
	title: string;
	description: string;
	keywords: readonly string[];
}

const row = (title: string, description = "", keywords: readonly string[] = []): Row => ({
	title,
	description,
	keywords,
});

const fields: readonly FuzzyField<Row>[] = [
	{ text: (item) => item.title, weight: 3 },
	{ text: (item) => item.description, weight: 2 },
	{ text: (item) => item.keywords.join(" "), weight: 1 },
];

describe("APP-15 rankFuzzy", () => {
	it("matches only the item whose title contains the query", () => {
		const rows = [row("Code theme"), row("App zoom")];
		const titleOnly: readonly FuzzyField<Row>[] = [{ text: (item) => item.title, weight: 1 }];
		const ranked = rankFuzzy(rows, "zom", titleOnly, 30);
		expect(ranked.map((entry) => entry.item.title)).toEqual(["App zoom"]);
	});

	it("ranks a weighted title match above a description match and a keyword match", () => {
		const rows = [
			row("Code theme", "", ["zoom"]),
			row("App zoom"),
			row("Appearance", "Control the app zoom level"),
		];
		const ranked = rankFuzzy(rows, "zom", fields, 30);
		expect(ranked.map((entry) => entry.item.title)).toEqual([
			"App zoom",
			"Appearance",
			"Code theme",
		]);
	});

	it("returns the ranges in each field", () => {
		const ranked = rankFuzzy([row("App zoom")], "zom", fields, 10);
		const titleRanges = ranked[0]?.ranges[0] ?? [];
		expect(titleRanges.map((range) => "App zoom".slice(range.start, range.end)).join("")).toBe(
			"zom",
		);
		expect(ranked[0]?.ranges[1]).toEqual([]);
		expect(ranked[0]?.ranges[2]).toEqual([]);

		const descriptionOnly = rankFuzzy(
			[row("Appearance", "Control the app zoom level")],
			"zom",
			fields,
			10,
		);
		expect(descriptionOnly[0]?.ranges[0]).toEqual([]);
		expect(descriptionOnly[0]?.ranges[1]).not.toEqual([]);
	});

	it("leaves out items that match no field", () => {
		const ranked = rankFuzzy([row("App zoom"), row("Code theme")], "zzz", fields, 10);
		expect(ranked).toEqual([]);
	});

	it("respects the limit and a limit of zero", () => {
		const rows = [row("Alpha"), row("Alpine"), row("Alps")];
		expect(rankFuzzy(rows, "alp", fields, 2)).toHaveLength(2);
		expect(rankFuzzy(rows, "alp", fields, 0)).toEqual([]);
	});

	it("keeps the input order for ties", () => {
		const rows = [row("Same"), row("Same"), row("Same")];
		const ranked = rankFuzzy(rows, "same", fields, 10);
		expect(ranked.map((entry) => entry.item)).toEqual(rows);
	});

	it("returns everything with score zero for a blank query", () => {
		const rows = [row("App zoom"), row("Code theme")];
		const ranked = rankFuzzy(rows, "   ", fields, 10);
		expect(ranked.map((entry) => entry.item)).toEqual(rows);
		expect(ranked.every((entry) => entry.score === 0)).toBe(true);
		expect(ranked.every((entry) => entry.ranges.length === fields.length)).toBe(true);
		expect(
			ranked.every((entry) => entry.ranges.every((fieldRanges) => fieldRanges.length === 0)),
		).toBe(true);
	});

	it("ranks 5,000 candidates", () => {
		const rows = Array.from({ length: 5000 }, (_, index) => row(`Item ${index}`));
		const ranked = rankFuzzy(rows, "item 4999", fields, 5);
		expect(ranked[0]?.item.title).toBe("Item 4999");
	});
});
