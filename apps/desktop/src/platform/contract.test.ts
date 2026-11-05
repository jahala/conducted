// @vitest-environment node
import { describe, expect, it } from "vitest";
import { type ContractHarness, PLATFORM_CONTRACT_CASES, runPlatformContract } from "./contract.ts";
import { createMemoryPlatform } from "./memory.ts";
import type { Database, Platform } from "./platform.ts";

const unusedDatabase: Database = {
	execute: () => Promise.reject(new Error("The coverage test does not use the database.")),
	select: () => Promise.reject(new Error("The coverage test does not use the database.")),
	transaction: () => Promise.reject(new Error("The coverage test does not use the database.")),
};

function missingContractGroups(
	groups: readonly string[],
	cases: readonly { group: string }[] = PLATFORM_CONTRACT_CASES,
): string[] {
	const covered = new Set(cases.map((testCase) => testCase.group));
	return groups.filter((group) => !covered.has(group));
}

describe("PLAT-01 platform contract coverage", () => {
	it("has at least one case for every Platform group", () => {
		const platform = createMemoryPlatform({
			clock: { now: () => 0 },
			ids: { uuid: () => "id" },
			database: unusedDatabase,
		}).platform;
		const groups = Object.keys(platform) as (keyof Platform)[];
		expect(missingContractGroups(groups)).toEqual([]);
	});

	it("flags a Platform group that has no case", () => {
		expect(missingContractGroups(["http", "not-a-real-group"])).toEqual(["not-a-real-group"]);
	});

	it("registers a step for every case", () => {
		const registered: string[] = [];
		const harness: ContractHarness = {
			describe: (_name, body) => {
				body();
			},
			it: (name) => {
				registered.push(name);
			},
			assert: () => {},
		};
		runPlatformContract(
			harness,
			"memory",
			async () => {
				throw new Error("The coverage test never runs a case.");
			},
			{ controls: true },
		);
		expect(registered).toHaveLength(PLATFORM_CONTRACT_CASES.length);
	});

	it("skips controls cases when the factory exposes no controls", () => {
		const registered: string[] = [];
		const skipped: string[] = [];
		const harness: ContractHarness = {
			describe: (_name, body) => {
				body();
			},
			it: (name) => {
				registered.push(name);
			},
			skip: (name) => {
				skipped.push(name);
			},
			assert: () => {},
		};
		runPlatformContract(
			harness,
			"tauri",
			async () => {
				throw new Error("The coverage test never runs a case.");
			},
			{ controls: false },
		);
		const controlsCases = PLATFORM_CONTRACT_CASES.filter(
			(testCase) => testCase.needs === "controls",
		);
		expect(skipped).toHaveLength(controlsCases.length);
		expect(registered).toHaveLength(PLATFORM_CONTRACT_CASES.length - controlsCases.length);
		for (const controlsCase of controlsCases) {
			expect(skipped.some((name) => name.startsWith(`${controlsCase.id}:`))).toBe(true);
		}
	});
});
