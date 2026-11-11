// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getSettingDef } from "../registries/settings.ts";
import {
	CONDUCTOR_SETTING_KEYS,
	CONDUCTOR_SETTINGS_KEPT_BACK,
	mapConductorSetting,
} from "./settings-map.ts";

const row = (key: string, value: string | null, deprecated_at: string | null = null) => ({
	key,
	value,
	deprecated_at,
});

describe("APP-17 Conductor's settings by the written key map", () => {
	it('default_message_send_mode "queued" maps to our "queue"', () => {
		expect(mapConductorSetting(row("default_message_send_mode", "queued"))).toEqual({
			kind: "mapped",
			key: "default_message_send_mode",
			value: "queue",
		});
	});

	it("reads Conductor's stored strings as our typed values", () => {
		expect(mapConductorSetting(row("wrap_lines", "true"))).toMatchObject({ value: true });
		expect(mapConductorSetting(row("terminal_font_size", "13"))).toMatchObject({ value: 13 });
	});

	it("leaves a row behind with its reason, never with its value", () => {
		const reasons = [
			mapConductorSetting(row("wrap_lines", "true", "2026-01-01 00:00:00")),
			mapConductorSetting(row("default_model", "opus")),
			mapConductorSetting(row("onboarding_step", "4")),
			mapConductorSetting(row("gh_token", "ghp_secretvalue")),
			mapConductorSetting(row("message_send_key", "banana-secret")),
		];
		expect(reasons.map((mapped) => mapped.kind)).toEqual([
			"left_out",
			"left_out",
			"left_out",
			"left_out",
			"left_out",
		]);
		const text = JSON.stringify(reasons);
		expect(text).not.toContain("ghp_secretvalue");
		expect(text).not.toContain("banana-secret");
		expect(text).toContain("~/.conductor/settings.toml");
	});

	it("maps only to keys our registry keeps in its database", () => {
		const wrong = Object.values(CONDUCTOR_SETTING_KEYS)
			.map((mapping) => mapping.key)
			.filter((key) => {
				const def = getSettingDef(key);
				return def === undefined || def.tomlKey !== undefined;
			});
		expect(wrong).toEqual([]);
		const both = Object.keys(CONDUCTOR_SETTINGS_KEPT_BACK).filter(
			(key) => CONDUCTOR_SETTING_KEYS[key] !== undefined,
		);
		expect(both).toEqual([]);
	});
});
