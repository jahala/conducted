/**
 * @feature RUN-06 Terminal tabs
 * Owns: the test for the rule a new terminal checks before it starts.
 * Test first: a store that has not loaded answers "loading".
 */
import { describe, expect, it } from "vitest";
import { terminalSettingsProblem } from "./terminal-settings.ts";

describe("RUN-06 terminal settings", () => {
	it("waits while the settings have not loaded", () => {
		expect(terminalSettingsProblem({ loaded: false, warnings: [] })).toBe("loading");
	});

	it("reports a settings load that failed", () => {
		expect(
			terminalSettingsProblem({
				loaded: true,
				warnings: [{ code: "settings_load_failed" }],
			}),
		).toBe("failed");
	});

	it("lets a terminal start once the settings are ready", () => {
		expect(terminalSettingsProblem({ loaded: true, warnings: [] })).toBeNull();
	});
});
