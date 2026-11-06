/**
 * @feature APP-06 Update notice view
 * Owns: tests for the pure mapping from the update status and the auto-restart setting to the
 * notice text and action.
 * Behaviour: ui-map.md 1.3; the table in update-notice-view.ts.
 * Test first: one case per row of the table.
 */
import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "../../core/api.ts";
import { describeUpdate } from "./update-notice-view.ts";

const status = (over: Partial<UpdateStatus>): UpdateStatus => ({
	state: "idle",
	version: null,
	notesUrl: null,
	error: null,
	...over,
});

describe("APP-06 update notice view", () => {
	it("shows nothing while idle or checking", () => {
		expect(describeUpdate(status({ state: "idle" }), false)).toBeNull();
		expect(describeUpdate(status({ state: "checking" }), true)).toBeNull();
	});

	it("offers Download when a version is available", () => {
		expect(describeUpdate(status({ state: "available", version: "0.2.0" }), false)).toEqual({
			text: "Version 0.2.0 is available",
			primary: { id: "download", label: "Download" },
			showSeeChanges: false,
		});
	});

	it("says what is downloading without an action", () => {
		expect(describeUpdate(status({ state: "downloading", version: "0.2.0" }), true)).toEqual({
			text: "Downloading version 0.2.0",
			primary: null,
			showSeeChanges: false,
		});
	});

	it("says the app restarts by itself when the setting is on", () => {
		expect(
			describeUpdate(
				status({
					state: "ready_when_idle",
					version: "0.2.0",
					notesUrl: "https://example.test/notes",
				}),
				true,
			),
		).toEqual({
			text: "Will automatically restart when all agents are idle",
			primary: null,
			showSeeChanges: true,
		});
	});

	it("offers Restart when idle when the setting is off", () => {
		expect(
			describeUpdate(
				status({
					state: "ready_when_idle",
					version: "0.2.0",
					notesUrl: "https://example.test/notes",
				}),
				false,
			),
		).toEqual({
			text: "Version 0.2.0 is ready",
			primary: { id: "restart_when_idle", label: "Restart when idle" },
			showSeeChanges: true,
		});
	});

	it("offers See changes only when release notes are published", () => {
		const ready = status({ state: "ready_when_idle", version: "0.2.0" });
		expect(describeUpdate(ready, false)?.showSeeChanges).toBe(false);
	});

	it("reports a failure with the error message and Retry", () => {
		expect(
			describeUpdate(
				status({ state: "error", version: "0.2.0", error: "Could not download" }),
				false,
			),
		).toEqual({
			text: "Update failed: Could not download",
			primary: { id: "retry", label: "Retry" },
			showSeeChanges: false,
		});
	});

	it("leaves out a version that is missing", () => {
		expect(describeUpdate(status({ state: "available" }), false)?.text).toBe(
			"An update is available",
		);
		expect(describeUpdate(status({ state: "downloading" }), false)?.text).toBe(
			"Downloading the update",
		);
		expect(describeUpdate(status({ state: "ready_when_idle" }), false)?.text).toBe(
			"The update is ready",
		);
	});

	it("says only that the update failed when no message came with it", () => {
		expect(describeUpdate(status({ state: "error" }), false)?.text).toBe("Update failed");
	});

	it("cuts a very long error message and keeps the notice readable", () => {
		const message = "x".repeat(400);
		const view = describeUpdate(status({ state: "error", error: message }), false);
		expect(view?.text.length).toBeLessThan(140);
		expect(view?.text.endsWith("…")).toBe(true);
	});

	it("gives the same answer for the same status", () => {
		const ready = status({
			state: "ready_when_idle",
			version: "0.2.0",
			notesUrl: "https://example.test/notes",
		});
		expect(describeUpdate(ready, false)).toEqual(describeUpdate(ready, false));
	});
});
