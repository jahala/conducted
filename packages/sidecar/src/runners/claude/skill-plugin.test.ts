import { describe, expect, test } from "bun:test";
import { bundledSkillPlugins } from "./skill-plugin.ts";

describe("AGENT-18 bundled Claude skill plugin", () => {
	test("AGENT-18 a folder becomes one local plugin with that path", () => {
		const result = bundledSkillPlugins(
			"/Applications/Conducted.app/Resources/conducted-skill",
			() => true,
		);
		expect(result).toEqual({
			ok: true,
			value: [{ type: "local", path: "/Applications/Conducted.app/Resources/conducted-skill" }],
		});
	});

	test("AGENT-18 no folder gives no plugin", () => {
		expect(bundledSkillPlugins(undefined, () => true)).toEqual({ ok: true, value: undefined });
		expect(bundledSkillPlugins("", () => true)).toEqual({ ok: true, value: undefined });
	});

	test("AGENT-18 a missing folder is an error that names it", () => {
		const result = bundledSkillPlugins("/nowhere/conducted-skill", () => false);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("skill_plugin_missing");
			expect(result.error.message).toContain("/nowhere/conducted-skill");
		}
	});

	test("AGENT-18 a relative path is refused", () => {
		const result = bundledSkillPlugins("conducted-skill", () => true);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe("skill_plugin_path_relative");
			expect(result.error.message).toContain("absolute");
		}
	});
});
