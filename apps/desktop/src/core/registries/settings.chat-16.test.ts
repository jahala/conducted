/**
 * @feature CHAT-16 Fork a chat from a turn
 * Tests the Experimental setting that turns the tab-menu fork and Cmd+Alt+Enter on.
 * Test first: the setting is on the Experimental page, starts off, and belongs to CHAT-16.
 */
import { describe, expect, it } from "vitest";
import { defaultValueOf, getSettingDef } from "./settings.ts";

describe("CHAT-16 fork chat to new tab setting", () => {
	it("offers Fork chat to new tab on the Experimental page, off by default", () => {
		const def = getSettingDef("experimental_fork_to_new_tab");

		expect(def).toMatchObject({
			page: "experimental",
			title: "Fork chat to new tab",
			feature: "CHAT-16",
			type: "bool",
			default: false,
		});
		expect(defaultValueOf("experimental_fork_to_new_tab")).toBe(false);
	});
});
