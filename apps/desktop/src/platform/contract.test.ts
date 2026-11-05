// @vitest-environment node
import { describe, expect, it } from "vitest";
import { memoryPlatformForShape, platformMethods } from "../test/memory-platform.ts";
import {
	CASE_METHODS,
	type ContractHarness,
	HANDLE_METHODS,
	methodsWithoutCoverage,
	PLATFORM_CONTRACT_CASES,
	runPlatformContract,
	UNCOVERED_METHODS,
} from "../test/platform-contract.ts";
import type { Database, Platform } from "./platform.ts";

function missingContractGroups(
	groups: readonly string[],
	cases: readonly { group: string }[] = PLATFORM_CONTRACT_CASES,
): string[] {
	const covered = new Set(cases.map((testCase) => testCase.group));
	return groups.filter((group) => !covered.has(group));
}

describe("PLAT-01 platform contract coverage", () => {
	it("has at least one case for every Platform group", () => {
		const platform = memoryPlatformForShape();
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

describe("PLAT-01 platform contract method coverage", () => {
	it("names every Platform method in a case or in the uncovered list", () => {
		const all = [...platformMethods(memoryPlatformForShape()), ...HANDLE_METHODS];
		expect(methodsWithoutCoverage(all)).toEqual([]);
	});

	it("flags a method that has neither a case nor a reason", () => {
		const all = ["fs.readText", "fs.invented", "pty.handle.invented"];
		expect(
			methodsWithoutCoverage(all, { "fs.read": ["fs.readText"] }, { "pty.handle.invented": "x" }),
		).toEqual(["fs.invented"]);
	});

	it("lists no method that a case already covers, and none that does not exist", () => {
		const all = new Set([...platformMethods(memoryPlatformForShape()), ...HANDLE_METHODS]);
		const covered = new Set(Object.values(CASE_METHODS).flat());
		expect(Object.keys(UNCOVERED_METHODS).filter((method) => covered.has(method))).toEqual([]);
		expect(Object.keys(UNCOVERED_METHODS).filter((method) => !all.has(method))).toEqual([]);
		expect([...covered].filter((method) => !all.has(method))).toEqual([]);
	});

	it("has a method list for every case and a case for every method list", () => {
		const ids = PLATFORM_CONTRACT_CASES.map((testCase) => testCase.id).sort();
		expect(Object.keys(CASE_METHODS).sort()).toEqual(ids);
	});

	it("lists the methods of the handles that spawn, start and download return", async () => {
		const platform = memoryPlatformForShape();
		const pty = await platform.pty.spawn({ cwd: "/", cols: 80, rows: 24 });
		if (!pty.ok) throw new Error(pty.error.message);
		const running = platform.shell.start({ program: "/bin/true", args: [], cwd: "/" });
		const download = platform.http.download({
			url: "https://example.invalid/x",
			destinationPath: "/x",
		});
		const listed = HANDLE_METHODS.map((name) => name.split(".").slice(-1)[0]).sort();
		const actual = [
			...Object.keys(pty.value).filter((key) => typeof (pty.value as never)[key] === "function"),
			...Object.keys(running).filter((key) => typeof (running as never)[key] === "function"),
			...Object.keys(download).filter((key) => typeof (download as never)[key] === "function"),
		].sort();
		expect(listed).toEqual(actual);
	});

	it("fails a case that did not call a method it names", async () => {
		const failures: string[] = [];
		const bodies: (() => Promise<void>)[] = [];
		const harness: ContractHarness = {
			describe: (_name, body) => {
				body();
			},
			it: (name, body) => {
				if (name.startsWith("app.version:")) bodies.push(body);
			},
			assert: (condition, message) => {
				if (!condition) failures.push(message);
			},
		};
		runPlatformContract(
			harness,
			"memory",
			async () => ({ platform: memoryPlatformForShape(), root: "/root", cleanup: async () => {} }),
			{ controls: true, methods: { "app.version": ["app.health"] } },
		);
		expect(bodies).toHaveLength(1);
		await bodies[0]?.();
		expect(failures).toEqual([
			"app.version did not call app.health, which CASE_METHODS says it does",
		]);
	});
});
