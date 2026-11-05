/**
 * @feature APP-02 Onboarding step setting
 * Owns: the check that the first-run guide records its progress in one setting key.
 * Behaviour: services-map.md 4.2.3 and the APP-02 rule "One onboarding step key for one flow".
 * Test first: `first_time_onboarding_step` is not a setting once the flow reads only
 * `onboarding_step`.
 */
import { describe, expect, it } from "vitest";
import { getSettingDef } from "../../core/registries/settings.ts";

describe("APP-02 onboarding setting", () => {
	it("uses one onboarding step key for the flow", () => {
		expect(getSettingDef("onboarding_step")).toBeDefined();
		expect(getSettingDef("first_time_onboarding_step")).toBeUndefined();
	});
});
