import { describe, expect, it } from "vitest";
import { parseSettingsPage, type SettingsTarget, settingsTargetKey } from "./settings-pages.ts";

describe("SET-02 settings pages", () => {
	it("parses a user page and a repository page", () => {
		expect(parseSettingsPage("git")).toEqual({ ok: true, value: { kind: "user", page: "git" } });
		expect(parseSettingsPage("repo:abc:scripts")).toEqual({
			ok: true,
			value: { kind: "repo", repoId: "abc", page: "scripts" },
		});
		// Conductor's repository sections include Environment and Git; Prompts are on Actions.
		expect(parseSettingsPage("repo:abc:environment").ok).toBe(true);
		expect(parseSettingsPage("repo:abc:git").ok).toBe(true);
		expect(parseSettingsPage("repo:abc:prompts").ok).toBe(false);
	});

	it("rejects an unknown page instead of falling back to General", () => {
		const result = parseSettingsPage("nope");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("settings_page_unknown");
	});

	it("rejects a repository page with no id and a page with extra colons", () => {
		expect(parseSettingsPage("repo::scripts").ok).toBe(false);
		expect(parseSettingsPage("repo:abc:scripts:extra").ok).toBe(false);
		expect(parseSettingsPage("repo:abc:nope").ok).toBe(false);
	});

	it("rejects an empty page and an unknown repository page", () => {
		expect(parseSettingsPage("").ok).toBe(false);
		expect(parseSettingsPage("repo:abc").ok).toBe(false);
	});

	it("gives each target a stable key", () => {
		const user: SettingsTarget = { kind: "user", page: "key-bindings" };
		const repo: SettingsTarget = { kind: "repo", repoId: "abc" as never, page: "scripts" };
		expect(settingsTargetKey(user)).toBe("key-bindings");
		expect(settingsTargetKey(repo)).toBe("repo:abc:scripts");
	});
});
