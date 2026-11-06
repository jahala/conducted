// @vitest-environment node
/**
 * @feature PLAT-21 Keep the Mac awake while agents work
 * Owns: the composition root's keep-awake wiring: the initial scan, following the setting and the
 * chats' work, the 10-second scan timer, the warning a failed scan logs, and cancelling
 * `caffeinate` on stop.
 * RC-04 adds the second rule: a chat's Remote Control session that connects keeps the Mac awake.
 * Test first: turning the setting on while a chat works starts one `caffeinate`.
 */
import { idleLiveState } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunningCommand, ShellCommand } from "../../platform/platform.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { KEEP_AWAKE_SCAN_MS } from "./keep-awake.ts";

// The lifetime job's startup step is unrelated to keep-awake, so it reports a skipped run.
vi.mock("../db/lifetime.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../db/lifetime.ts")>();
	return {
		...actual,
		runDataLifetimeJob: async () => ({
			ok: true,
			value: { kind: "skipped", lastRunAt: 0 },
		}),
	};
});

const AC_OUTPUT =
	"Now drawing from 'AC Power'\n -InternalBattery-0 (id=1234)\t84%; charged; 0:00 remaining present: true\n";

const WORKING = { ...idleLiveState, status: "working" as const };

let current: TestContainer | null = null;
const cancels: string[] = [];

afterEach(async () => {
	await current?.container.stop();
	current?.close();
	current = null;
	cancels.length = 0;
	vi.restoreAllMocks();
});

interface Harness {
	test: TestContainer;
	starts: ShellCommand[];
}

function build(options: { pmsetFails?: boolean } = {}): Harness {
	const test = createTestContainer();
	current = test;
	const starts: ShellCommand[] = [];
	test.memory.controls.scriptShell((command) => {
		if (command.program === "pmset") {
			return options.pmsetFails === true
				? err(appError("pmset_failed", "pmset failed"))
				: ok({ exitCode: 0, stdout: AC_OUTPUT, stderr: "" });
		}
		if (command.program === "caffeinate") return ok({ exitCode: 0, stdout: "", stderr: "" });
		return null;
	});
	const original = test.memory.platform.shell.start.bind(test.memory.platform.shell);
	test.memory.platform.shell.start = (command: ShellCommand): RunningCommand => {
		starts.push(command);
		const running = original(command);
		return {
			id: running.id,
			done: running.done,
			cancel: async () => {
				cancels.push(command.program);
				await running.cancel();
			},
		};
	};
	return { test, starts };
}

const caffeinateStarts = (starts: ShellCommand[]): ShellCommand[] =>
	starts.filter((command) => command.program === "caffeinate");

const pmsetReads = (test: TestContainer): ShellCommand[] =>
	test.memory.controls.shellCalls.filter((command) => command.program === "pmset");

/** Starts the container with the services unrelated to keep-awake quiet. */
async function startContainer(test: TestContainer): Promise<void> {
	const { services } = test.container;
	for (const service of [
		services.repo,
		services.workspace,
		services.sections,
		services.favoriteModels,
		services.terminals,
		services.system,
	]) {
		vi.spyOn(service, "start").mockResolvedValue(ok(undefined) as never);
	}
	vi.spyOn(services.github, "checkAccess").mockResolvedValue(ok({ status: "unknown" }));
	// RUN-01 has not built the stop yet; the container's stop is not what these tests check.
	vi.spyOn(services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
	expect((await test.container.start()).ok).toBe(true);
}

function setSetting(test: TestContainer, enabled: boolean): void {
	const settings = test.container.services.settings;
	settings.store.setState((state) => ({
		values: { ...state.values, caffeinate_while_agents_running: enabled },
	}));
}

function setWorking(test: TestContainer, working: boolean): void {
	test.container.services.sessions.store.setState({
		liveStates: working ? { "chat-1": WORKING } : {},
	});
}

describe("RC-04 keep-awake wiring for Remote Control", () => {
	it("starts caffeinate when a chat's Remote Control session connects, and stops it when it ends", async () => {
		const { test, starts } = build();
		await startContainer(test);
		const sessions = test.container.services.sessions;

		sessions.applyRemoteControlState("chat-1" as never, { state: "ready" });
		expect(caffeinateStarts(starts)).toHaveLength(0);

		// caffeinate keeps running until it is cancelled, as the real one does.
		test.memory.controls.holdNextStart();
		sessions.applyRemoteControlState("chat-1" as never, {
			state: "connected",
			sessionUrl: "https://claude.ai/code/session_1",
		});
		await vi.waitFor(() => expect(caffeinateStarts(starts)).toHaveLength(1));

		sessions.applyRemoteControlState("chat-1" as never, { state: "off" });
		await vi.waitFor(() => expect(cancels).toEqual(["caffeinate"]));
	});
});

describe("PLAT-21 keep-awake wiring", () => {
	it("starts caffeinate when a chat starts working while the setting is on", async () => {
		const { test, starts } = build();
		await startContainer(test);

		setSetting(test, true);
		expect(caffeinateStarts(starts)).toHaveLength(0);

		setWorking(test, true);
		await vi.waitFor(() => expect(caffeinateStarts(starts)).toHaveLength(1));
		expect(caffeinateStarts(starts)[0]).toMatchObject({ program: "caffeinate", args: ["-i"] });
	});

	it("starts caffeinate when the setting is turned on while a chat works", async () => {
		const { test, starts } = build();
		await startContainer(test);

		setWorking(test, true);
		expect(caffeinateStarts(starts)).toHaveLength(0);

		setSetting(test, true);
		await vi.waitFor(() => expect(caffeinateStarts(starts)).toHaveLength(1));
	});

	it("scans on the 10-second timer and clears the timer on stop", async () => {
		const { test, starts } = build();
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
		const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
		await startContainer(test);

		const index = setIntervalSpy.mock.calls.findIndex(([, ms]) => ms === KEEP_AWAKE_SCAN_MS);
		expect(index).toBeGreaterThanOrEqual(0);
		const timer = setIntervalSpy.mock.results[index]?.value as ReturnType<typeof setInterval>;
		const callback = setIntervalSpy.mock.calls[index]?.[0] as () => void;

		setWorking(test, true);
		test.memory.controls.holdNextStart();
		setSetting(test, true);
		await vi.waitFor(() => expect(caffeinateStarts(starts)).toHaveLength(1));
		expect(pmsetReads(test)).toHaveLength(1);

		callback();
		await vi.waitFor(() => expect(pmsetReads(test)).toHaveLength(2));

		await test.container.stop();
		expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
		expect(cancels).toContain("caffeinate");
	});

	it("runs one more scan, not one per change, when a change lands mid-scan", async () => {
		const { test, starts } = build();
		// Hold the first pmset read so a change can land while its scan runs.
		const originalRun = test.memory.platform.shell.run.bind(test.memory.platform.shell);
		const gate: { release: (() => void) | null } = { release: null };
		let holdPmset = true;
		test.memory.platform.shell.run = async (command) => {
			if (command.program === "pmset" && holdPmset) {
				holdPmset = false;
				await new Promise<void>((resolve) => {
					gate.release = resolve;
				});
			}
			return originalRun(command);
		};
		await startContainer(test);

		setWorking(test, true);
		test.memory.controls.holdNextStart();
		setSetting(test, true);
		await vi.waitFor(() => expect(gate.release).not.toBeNull());

		// Two changes while the scan waits get one trailing scan, not one each.
		setSetting(test, false);
		setSetting(test, true);
		gate.release?.();
		gate.release = null;

		await vi.waitFor(() => expect(pmsetReads(test)).toHaveLength(2));
		expect(caffeinateStarts(starts)).toHaveLength(1);
	});

	it("logs a warning when a scan fails", async () => {
		const { test } = build({ pmsetFails: true });
		await startContainer(test);

		setWorking(test, true);
		setSetting(test, true);

		await vi.waitFor(() =>
			expect(
				test.memory.controls.logs.some((line) =>
					line.message.startsWith("Could not keep the Mac awake"),
				),
			).toBe(true),
		);
	});
});
