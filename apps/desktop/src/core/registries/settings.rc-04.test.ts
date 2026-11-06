/**
 * @feature RC-04 Remote Control settings
 * Owns: the Remote Control page's two settings: Remote Control for new chats, and keeping the Mac
 * awake while a Remote Control session is connected.
 * Behaviour: ui-map.md 6 "Remote control" ("Keep this Mac awake"), services-map.md 5B.2.1
 * (`remote_control_keep_awake`, default true).
 * Test first: the Remote Control page lists both settings, keep awake on and new chats off.
 */
import { describe, expect, it } from "vitest";
import { getSettingDef, SETTING_PAGES, settingsForPage } from "./settings.ts";

describe("RC-04 Remote Control settings", () => {
	it("has its own page with the new-chat switch and keep awake", () => {
		expect(SETTING_PAGES).toContain("remote-control");
		expect(settingsForPage("remote-control").map((def) => def.key)).toEqual([
			"remote_control_new_chats",
			"remote_control_keep_awake",
		]);
	});

	it("keeps the Mac awake by default, as Conductor does", () => {
		const def = getSettingDef("remote_control_keep_awake");
		expect(def?.type).toBe("bool");
		expect(def?.title).toBe("Keep this Mac awake");
		if (def?.type === "bool") expect(def.default).toBe(true);
	});

	it("leaves Remote Control off for new chats until the user turns it on", () => {
		const def = getSettingDef("remote_control_new_chats");
		expect(def?.type).toBe("bool");
		if (def?.type === "bool") expect(def.default).toBe(false);
		expect(def?.feature).toBe("RC-04");
	});
});
