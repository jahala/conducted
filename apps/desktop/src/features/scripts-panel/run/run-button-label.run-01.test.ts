/**
 * @feature RUN-01 Run button label
 * Owns: tests for the words, enabled state and click effect of the Run button in each phase.
 * Test first: phase "running" for action "Dev server" gives "Stop Dev server" with click "stop".
 */
import { describe, expect, it } from "vitest";
import { runButtonModel } from "./run-button-label.ts";

const dev = { id: "dev", label: "Dev server", isSpotlight: false };
const spotlight = { id: "spotlight", label: "Spotlight", isSpotlight: true };

describe("RUN-01 run button label", () => {
	it("gives Stop Dev server with click stop while it runs", () => {
		expect(runButtonModel(dev, "running", false)).toEqual({
			label: "Stop Dev server",
			disabled: false,
			click: "stop",
		});
	});

	it("says Run the first time and Run again after a run", () => {
		expect(runButtonModel(dev, "stopped", false)).toEqual({
			label: "Run Dev server",
			disabled: false,
			click: "start",
		});
		expect(runButtonModel(dev, "stopped", true)).toEqual({
			label: "Run Dev server again",
			disabled: false,
			click: "start",
		});
	});

	it("disables the button while starting and stopping", () => {
		expect(runButtonModel(dev, "starting", false)).toEqual({
			label: "Starting...",
			disabled: true,
			click: null,
		});
		expect(runButtonModel(dev, "stopping", true)).toEqual({
			label: "Stopping...",
			disabled: true,
			click: null,
		});
	});

	it("lets the user cancel a start parked behind setup", () => {
		expect(runButtonModel(dev, "waiting_for_setup", false)).toEqual({
			label: "Waiting for setup",
			disabled: false,
			click: "stop",
		});
	});

	it("uses the action id when the label is empty", () => {
		expect(
			runButtonModel({ id: "dev", label: " ", isSpotlight: false }, "running", false).label,
		).toBe("Stop dev");
	});

	it("maps the spotlight action to its own two words", () => {
		expect(runButtonModel(spotlight, "stopped", false)).toEqual({
			label: "Start spotlight",
			disabled: false,
			click: "start_spotlight",
		});
		expect(runButtonModel(spotlight, "running", true)).toEqual({
			label: "Stop spotlight",
			disabled: false,
			click: "stop_spotlight",
		});
	});
});
