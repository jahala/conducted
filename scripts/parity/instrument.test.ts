import { describe, expect, test } from "bun:test";
import type { Finding } from "./checks.ts";
import { CONDUCTOR_COMPOSER_PLACEHOLDER, instrument } from "./instrument.ts";

const finding = (overrides: Partial<Finding>): Finding => ({
	check: "b",
	severity: "gap",
	code: "ours-only",
	screen: "App shell",
	detail: "button text: aside > button",
	...overrides,
});

const allThree: Finding[] = [
	finding({ state: "sidebar", text: "Add a project" }),
	finding({ state: "composer-empty", text: "Write something ..." }),
	finding({
		code: "missing-in-state",
		state: "composer-empty",
		text: CONDUCTOR_COMPOSER_PLACEHOLDER,
	}),
	finding({
		check: "c",
		code: "layout-off",
		id: "tool-call-row",
		detail: "padding-top 0 (Conductor 6)",
	}),
];

describe("the instrument check", () => {
	test("passes when the report holds all three known misses", () => {
		const result = instrument(allThree);
		expect(result.missing).toEqual([]);
		expect(result.found).toHaveLength(4);
	});

	test("names each part it did not find, including half of the placeholder miss", () => {
		const result = instrument(allThree.filter((f) => f.code !== "missing-in-state"));
		expect(result.missing).toEqual([
			"The composer's \"Write something ...\" placeholder: Conductor's composer placeholder missing from its state",
		]);
	});

	test("the same text in another state or another check does not count", () => {
		const elsewhere = [
			finding({ state: "first-run", text: "Add a project" }),
			finding({ check: "c", code: "layout-off", id: "workspace-row" }),
		];
		expect(instrument(elsewhere).found).toEqual([]);
	});
});
