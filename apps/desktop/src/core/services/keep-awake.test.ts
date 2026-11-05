/**
 * @feature PLAT-21 Keep the Mac awake while agents work
 * Owns: tests for the keep-awake rule, the `pmset` reader and the service's process handling.
 * Test first: with the setting on and a chat working, `scan` starts exactly one `caffeinate`.
 */
import { appError, err, ok } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { Shell, ShellCommand } from "../../platform/platform.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import {
	KEEP_AWAKE_MIN_BATTERY_PERCENT,
	type KeepAwakeInput,
	KeepAwakeService,
	parseBattery,
	shouldKeepAwake,
} from "./keep-awake.ts";

const BATTERY_OUTPUT =
	"Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t9%; discharging; 3:12 remaining present: true\n";
const AC_OUTPUT =
	"Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t84%; charged; 0:00 remaining present: true\n";
const NO_BATTERY_OUTPUT = "Now drawing from 'AC Power'\n";

const batteryAt = (percent: number): string =>
	`Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t${percent}%; discharging; 3:12 remaining present: true\n`;

const input = (overrides: Partial<KeepAwakeInput> = {}): KeepAwakeInput => ({
	enabled: true,
	chatWorking: true,
	battery: { percent: 84, onBattery: true },
	...overrides,
});

describe("PLAT-21 shouldKeepAwake", () => {
	it("stays awake only with the setting on and a chat working", () => {
		expect(shouldKeepAwake(input())).toBe(true);
		expect(shouldKeepAwake(input({ enabled: false }))).toBe(false);
		expect(shouldKeepAwake(input({ chatWorking: false }))).toBe(false);
	});

	it("ignores the battery while the Mac runs on power", () => {
		expect(shouldKeepAwake(input({ battery: { percent: 5, onBattery: false } }))).toBe(true);
	});

	it("lets the Mac sleep on battery at or below the minimum", () => {
		expect(
			shouldKeepAwake(
				input({ battery: { percent: KEEP_AWAKE_MIN_BATTERY_PERCENT, onBattery: true } }),
			),
		).toBe(false);
		expect(
			shouldKeepAwake(
				input({ battery: { percent: KEEP_AWAKE_MIN_BATTERY_PERCENT - 1, onBattery: true } }),
			),
		).toBe(false);
		expect(
			shouldKeepAwake(
				input({ battery: { percent: KEEP_AWAKE_MIN_BATTERY_PERCENT + 1, onBattery: true } }),
			),
		).toBe(true);
	});

	it("does not apply the battery rule on a Mac without a battery", () => {
		expect(shouldKeepAwake(input({ battery: null }))).toBe(true);
	});
});

describe("PLAT-21 parseBattery", () => {
	it("reads the percentage and the power source", () => {
		expect(parseBattery(BATTERY_OUTPUT)).toEqual({
			ok: true,
			value: { percent: 9, onBattery: true },
		});
		expect(parseBattery(AC_OUTPUT)).toEqual({
			ok: true,
			value: { percent: 84, onBattery: false },
		});
	});

	it("reports no battery reading on a Mac without a battery", () => {
		expect(parseBattery(NO_BATTERY_OUTPUT)).toEqual({ ok: true, value: null });
	});

	it("returns an error instead of guessing when the battery line is unreadable", () => {
		const result = parseBattery(
			"Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\tunknown; discharging\n",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("battery_unreadable");
	});
});

interface Harness {
	service: KeepAwakeService;
	memory: TestContainer["memory"];
	setting: { enabled: boolean };
	activity: { working: boolean };
	battery: { output: string };
	starts: ShellCommand[];
	runFailure: { message: string | null };
	settingKeys: string[];
	cancels: number;
}

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function createHarness(): Harness {
	const test = createTestContainer();
	const memory = test.memory;
	const starts: ShellCommand[] = [];
	const setting = { enabled: true };
	const activity = { working: true };
	const battery = { output: AC_OUTPUT };
	const runFailure = { message: null as string | null };
	const settingKeys: string[] = [];
	let cancels = 0;

	memory.controls.scriptShell((command) => {
		if (command.program === "pmset") {
			return runFailure.message === null
				? ok({ exitCode: 0, stdout: battery.output, stderr: "" })
				: err(appError("shell_unscripted", runFailure.message));
		}
		if (command.program === "caffeinate") {
			return ok({ exitCode: 0, stdout: "", stderr: "" });
		}
		return null;
	});

	const shell: Shell = {
		...memory.platform.shell,
		start: (command) => {
			starts.push(command);
			const running = memory.platform.shell.start(command);
			const cancel = running.cancel;
			return {
				id: running.id,
				done: running.done,
				cancel: async () => {
					cancels += 1;
					await cancel();
				},
			};
		},
	};

	const service = new KeepAwakeService({
		platform: { ...memory.platform, shell },
		setting: <T>(key: string): T => {
			settingKeys.push(key);
			return setting.enabled as unknown as T;
		},
		anyChatWorking: () => activity.working,
	});

	cleanups.push(async () => {
		await service.stop();
		test.close();
	});

	return {
		service,
		memory,
		setting,
		activity,
		battery,
		starts,
		runFailure,
		settingKeys,
		get cancels() {
			return cancels;
		},
	};
}

const caffeinateStarts = (harness: Harness): ShellCommand[] =>
	harness.starts.filter((command) => command.program === "caffeinate");

describe("PLAT-21 KeepAwakeService", () => {
	it("starts exactly one caffeinate when the setting is on and a chat works", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();

		expect(await harness.service.scan()).toEqual({ ok: true, value: undefined });
		expect(harness.settingKeys).toContain("caffeinate_while_agents_running");
		const starts = caffeinateStarts(harness);
		expect(starts).toHaveLength(1);
		expect(starts[0]).toMatchObject({
			program: "caffeinate",
			args: ["-i"],
			cwd: harness.memory.platform.fs.paths.home,
		});

		expect(await harness.service.scan()).toEqual({ ok: true, value: undefined });
		expect(caffeinateStarts(harness)).toHaveLength(1);
	});

	it("starts no second caffeinate when two scans overlap", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();

		await Promise.all([harness.service.scan(), harness.service.scan()]);

		expect(caffeinateStarts(harness)).toHaveLength(1);
	});

	it("cancels caffeinate when the setting is turned off", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();
		await harness.service.scan();

		harness.setting.enabled = false;
		expect(await harness.service.scan()).toEqual({ ok: true, value: undefined });

		expect(harness.cancels).toBe(1);
		expect(caffeinateStarts(harness)).toHaveLength(1);
	});

	it("cancels caffeinate when no chat is working", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();
		await harness.service.scan();

		harness.activity.working = false;
		expect(await harness.service.scan()).toEqual({ ok: true, value: undefined });

		expect(harness.cancels).toBe(1);
	});

	it("cancels caffeinate on battery at or below the minimum", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();
		await harness.service.scan();

		harness.battery.output = batteryAt(KEEP_AWAKE_MIN_BATTERY_PERCENT);
		expect(await harness.service.scan()).toEqual({ ok: true, value: undefined });

		expect(harness.cancels).toBe(1);
		expect(caffeinateStarts(harness)).toHaveLength(1);
	});

	it("keeps caffeinate running when the battery cannot be read", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();
		await harness.service.scan();

		harness.battery.output =
			"Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\tunknown; discharging\n";
		const outcome = await harness.service.scan();

		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error.code).toBe("battery_unreadable");
		expect(harness.cancels).toBe(0);
		expect(caffeinateStarts(harness)).toHaveLength(1);
	});

	it("keeps caffeinate running when pmset fails", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();
		await harness.service.scan();

		harness.runFailure.message = "pmset failed";
		const outcome = await harness.service.scan();

		expect(outcome.ok).toBe(false);
		expect(harness.cancels).toBe(0);
		expect(caffeinateStarts(harness)).toHaveLength(1);
	});

	it("keeps caffeinate running on a Mac without a battery", async () => {
		const harness = createHarness();
		harness.battery.output = NO_BATTERY_OUTPUT;
		harness.memory.controls.holdNextStart();

		expect(await harness.service.scan()).toEqual({ ok: true, value: undefined });

		expect(caffeinateStarts(harness)).toHaveLength(1);
	});

	it("starts caffeinate again after it exits while the rule still holds", async () => {
		const harness = createHarness();

		await harness.service.scan();
		await Promise.resolve();
		await harness.service.scan();

		expect(caffeinateStarts(harness)).toHaveLength(2);
	});

	it("stops caffeinate by cancelling the running process", async () => {
		const harness = createHarness();
		harness.memory.controls.holdNextStart();
		await harness.service.scan();

		await harness.service.stop();
		await harness.service.stop();

		expect(harness.cancels).toBe(1);
	});
});
