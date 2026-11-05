/**
 * @feature WS-03 Setup tab view state
 * Owns: tests for the state table and the actions each kind offers.
 * Test first: state "failed" with a log gives view "failed" and exposes the fix action.
 */
import type { TerminalId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { SetupView } from "../../../core/model.ts";
import { setupTabActions, setupTabKind } from "./setup-state.ts";

const view = (overrides: Partial<SetupView> = {}): SetupView => ({
	state: "idle",
	hasScript: true,
	exitCode: null,
	filesCopied: null,
	terminalId: null,
	log: "missing",
	interruptedReason: null,
	...overrides,
});

describe("WS-03 setup tab view state", () => {
	it("gives a failed run its log view and the fix action", () => {
		const kind = setupTabKind(
			view({ state: "failed", exitCode: 1, log: "saved", terminalId: "t1" as TerminalId }),
		);

		expect(kind).toBe("failed");
		expect(setupTabActions(kind)).toMatchObject({ askAgentToFix: true, runAgain: true });
	});

	it("offers Add setup script only when the repository has none", () => {
		expect(setupTabKind(view({ hasScript: false }))).toBe("no_script");
		expect(setupTabActions("no_script").addScript).toBe(true);
		expect(setupTabKind(view({ hasScript: true }))).toBe("not_run");
		expect(setupTabActions("not_run").addScript).toBe(false);
	});

	it("follows the run states in the research order", () => {
		expect(setupTabKind(view({ state: "detecting" }))).toBe("detecting");
		expect(setupTabKind(view({ state: "running", log: "live" }))).toBe("running");
		expect(setupTabKind(view({ state: "stopping" }))).toBe("stopping");
		expect(setupTabKind(view({ state: "cancelled" }))).toBe("cancelled");
		expect(setupTabKind(view({ state: "completed", log: "saved" }))).toBe("completed");
	});

	it("shows the log-missing view only for an expired log with no active run", () => {
		expect(setupTabKind(view({ log: "expired" }))).toBe("log_missing");
		expect(setupTabKind(view({ log: "missing" }))).toBe("not_run");
		expect(setupTabKind(view({ state: "completed", log: "expired" }))).toBe("completed");
	});

	it("offers Stop only while running", () => {
		expect(setupTabActions("running").stop).toBe(true);
		expect(setupTabActions("stopping").stop).toBe(false);
		expect(setupTabActions("completed")).toMatchObject({ runAgain: true, stop: false });
	});
});
