import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	coerceSettingValue,
	defaultValueOf,
	getSettingDef,
	isFileBacked,
	SETTING_KEYS,
	SETTING_PAGES,
	SETTINGS,
	type SettingDef,
	searchSettings,
	settingsForPage,
	tomlKeys,
} from "./settings.ts";

const here = dirname(fileURLToPath(import.meta.url));
const backlog = readFileSync(resolve(here, "../../../../../docs/plans/backlog.md"), "utf8");
const backlogIds = new Set(backlog.match(/^\| [A-Z]+-\d+/gm)?.map((row) => row.slice(2)) ?? []);

const must = (key: string): SettingDef => {
	const def = getSettingDef(key);
	if (def === undefined) {
		throw new Error(`missing setting ${key}`);
	}
	return def;
};

describe("setting table", () => {
	it("has unique keys", () => {
		expect(new Set(SETTING_KEYS).size).toBe(SETTING_KEYS.length);
	});

	it("reads the feature ids from the backlog file", () => {
		expect(backlogIds.has("SET-01")).toBe(true);
	});

	it("points every setting at a feature in the backlog", () => {
		expect(SETTINGS.filter((s) => !backlogIds.has(s.feature)).map((s) => s.key)).toEqual([]);
	});

	it("keeps every enum default among its options", () => {
		for (const def of SETTINGS) {
			if (def.type === "enum") {
				expect(
					def.options.map((o) => o.value),
					def.key,
				).toContain(def.default);
			}
		}
	});

	it("gives every file-backed setting its file layers and every other setting none", () => {
		for (const def of SETTINGS) {
			if (def.tomlKey !== undefined) {
				expect(["user", "user-and-repo"], def.key).toContain(def.fileLayers);
			} else {
				expect(def.fileLayers, def.key).toBeUndefined();
			}
		}
	});

	it("keeps number defaults inside their own range", () => {
		for (const def of SETTINGS) {
			if (def.type === "number") {
				expect(def.min === undefined || def.default >= def.min, def.key).toBe(true);
				expect(def.max === undefined || def.default <= def.max, def.key).toBe(true);
			}
		}
	});

	it("makes every default pass its own check", () => {
		for (const def of SETTINGS) {
			const result = coerceSettingValue(def, defaultValueOf(def.key));
			expect(result.ok, def.key).toBe(true);
		}
	});

	it("uses titles and descriptions on every setting and no page outside the list", () => {
		for (const def of SETTINGS) {
			expect(def.title.length, def.key).toBeGreaterThan(0);
			expect(def.description.length, def.key).toBeGreaterThan(0);
			expect(SETTING_PAGES, def.key).toContain(def.page);
			expect(def.scopes.length, def.key).toBeGreaterThan(0);
		}
	});

	it("only lets repo scopes through where a repo file may set the key", () => {
		for (const def of SETTINGS) {
			if (def.scopes.includes("repo")) {
				expect(def.fileLayers, def.key).toBe("user-and-repo");
			}
		}
	});

	it("has at least one setting on every page", () => {
		for (const page of SETTING_PAGES) {
			expect(settingsForPage(page).length, page).toBeGreaterThan(0);
		}
	});

	it("keeps the send mode design choice", () => {
		const def = must("default_message_send_mode");
		expect(def.default).toBe("steer");
		expect(def.type === "enum" && def.options.map((o) => o.value)).toEqual(["steer", "queue"]);
	});

	it("keeps toml keys unique", () => {
		const keys = SETTINGS.flatMap((s) => (s.tomlKey === undefined ? [] : [s.tomlKey]));
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("lookups", () => {
	it("finds a setting by key and returns undefined for an unknown key", () => {
		expect(getSettingDef("branch_prefix_type")?.page).toBe("git");
		expect(getSettingDef("nope")).toBeUndefined();
	});

	it("holds the left panel width on the state page with default 256", () => {
		const def = settingsForPage("state").find((s) => s.key === "left_panel_width");
		expect(def?.default).toBe(256);
		expect(defaultValueOf("left_panel_width")).toBe(256);
	});

	it("returns undefined default for an unknown key and a fresh list for list settings", () => {
		expect(defaultValueOf("nope")).toBeUndefined();
		const first = defaultValueOf("file_include_globs");
		expect(first).toEqual([]);
		if (Array.isArray(first)) {
			first.push("changed");
		}
		expect(defaultValueOf("file_include_globs")).toEqual([]);
	});

	it("reports which settings are file backed", () => {
		expect(isFileBacked(must("delete_branch_on_archive"))).toBe(true);
		expect(isFileBacked(must("message_send_key"))).toBe(false);
	});

	it("maps toml keys to setting keys", () => {
		const map = tomlKeys();
		expect(map["git.delete_branch_on_archive"]).toBe("delete_branch_on_archive");
		expect(map["scripts.run_mode"]).toBe("run_script_mode");
		expect(map["models.default"]).toBe("default_model");
		expect(Object.values(map).sort()).toEqual(
			SETTINGS.filter((s) => s.tomlKey !== undefined)
				.map((s) => s.key)
				.sort(),
		);
	});
});

describe("searchSettings", () => {
	it("ranks title matches before other matches", () => {
		const found = searchSettings("branch");
		expect(found.length).toBeGreaterThan(1);
		const firstNonTitle = found.findIndex((d) => !d.title.toLowerCase().includes("branch"));
		const lastTitle = found.map((d) => d.title.toLowerCase().includes("branch")).lastIndexOf(true);
		expect(firstNonTitle === -1 || lastTitle < firstNonTitle).toBe(true);
	});

	it("is case insensitive and also matches search terms", () => {
		expect(searchSettings("DOTENV").map((d) => d.key)).toContain("environment_variable_files");
		expect(searchSettings("steer")[0]?.key).toBe("default_message_send_mode");
	});

	it("respects the limit and keeps a stable order", () => {
		const all = searchSettings("e", 500);
		expect(all.length).toBeGreaterThan(3);
		expect(searchSettings("e", 3)).toEqual(all.slice(0, 3));
		expect(searchSettings("e", 500)).toEqual(all);
		expect(searchSettings("e").length).toBeLessThanOrEqual(30);
	});

	it("returns nothing for an empty query, a zero limit or no match, and hides the state page", () => {
		expect(searchSettings("   ")).toEqual([]);
		expect(searchSettings("branch", 0)).toEqual([]);
		expect(searchSettings("zzzzzz-no-match")).toEqual([]);
		expect(searchSettings("left_panel_width")).toEqual([]);
	});
});

describe("coerceSettingValue", () => {
	it("accepts bool values and the strings true and false", () => {
		const def = must("notifications_enabled");
		expect(coerceSettingValue(def, true)).toEqual({ ok: true, value: true });
		expect(coerceSettingValue(def, "true")).toEqual({ ok: true, value: true });
		expect(coerceSettingValue(def, "false")).toEqual({ ok: true, value: false });
	});

	it("rejects other bool input with a setting_invalid error", () => {
		const def = must("notifications_enabled");
		for (const bad of ["maybe", 1, "TRUE", undefined, {}]) {
			const result = coerceSettingValue(def, bad);
			expect(result.ok, String(bad)).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("setting_invalid");
			}
		}
	});

	it("accepts numbers and numeric text inside the range", () => {
		const def = must("terminal_font_size");
		expect(coerceSettingValue(def, 14)).toEqual({ ok: true, value: 14 });
		expect(coerceSettingValue(def, "14")).toEqual({ ok: true, value: 14 });
		expect(coerceSettingValue(def, " 9.5 ")).toEqual({ ok: true, value: 9.5 });
	});

	it("rejects numbers out of range, empty text, words and non-finite numbers", () => {
		const def = must("terminal_font_size");
		for (const bad of [7, 33, "", "  ", "big", Number.NaN, Number.POSITIVE_INFINITY, true]) {
			expect(coerceSettingValue(def, bad).ok, String(bad)).toBe(false);
		}
	});

	it("accepts enum members and rejects others", () => {
		const def = must("branch_prefix_type");
		expect(coerceSettingValue(def, "custom")).toEqual({ ok: true, value: "custom" });
		const result = coerceSettingValue(def, "everyone");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toContain("github_username");
		}
		expect(coerceSettingValue(def, 3).ok).toBe(false);
	});

	it("accepts text for strings and rejects other types", () => {
		const def = must("setup_script");
		expect(coerceSettingValue(def, "pnpm install")).toEqual({ ok: true, value: "pnpm install" });
		expect(coerceSettingValue(def, "")).toEqual({ ok: true, value: "" });
		expect(coerceSettingValue(def, 5).ok).toBe(false);
	});

	it("accepts lists, and turns text into one entry per line", () => {
		const def = must("file_include_globs");
		expect(coerceSettingValue(def, [".env", "config/*.json"])).toEqual({
			ok: true,
			value: [".env", "config/*.json"],
		});
		expect(coerceSettingValue(def, ".env\n\n  config/*.json \n")).toEqual({
			ok: true,
			value: [".env", "config/*.json"],
		});
		expect(coerceSettingValue(def, [1, 2]).ok).toBe(false);
		expect(coerceSettingValue(def, 7).ok).toBe(false);
	});

	it("treats null as no value for every type and undefined as an error", () => {
		for (const def of SETTINGS) {
			expect(coerceSettingValue(def, null), def.key).toEqual({ ok: true, value: null });
		}
		expect(coerceSettingValue(must("wrap_lines"), undefined).ok).toBe(false);
	});
});
