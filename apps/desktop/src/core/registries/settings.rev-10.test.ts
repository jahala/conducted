/**
 * @feature REV-10 The "Show Artifacts tab" setting
 * Owns: the setting's place on the General page, its boolean type and its on-by-default value.
 * Behaviour: ui-map.md 6 ("Show Artifacts tab"); services-map.md 4.2.3 (`artifacts_tab_enabled`).
 * Test first: getSettingDef("artifacts_tab_enabled") is a General boolean that defaults to true.
 */
import { describe, expect, it } from "vitest";
import { getSettingDef, settingsForPage } from "./settings.ts";

describe("REV-10 Show Artifacts tab setting", () => {
	it("is a General setting that is on by default", () => {
		const def = getSettingDef("artifacts_tab_enabled");

		expect(def?.page).toBe("general");
		expect(def?.title).toBe("Show Artifacts tab");
		expect(def?.type).toBe("bool");
		if (def?.type === "bool") expect(def.default).toBe(true);
		expect(settingsForPage("general").some((entry) => entry.key === "artifacts_tab_enabled")).toBe(
			true,
		);
	});
});
