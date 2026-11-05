import { describe, expect, it } from "vitest";
import { zshIntegrationDir } from "./shell-integration.ts";

const paths = {
	home: "/Users/a/",
	appData: "/Users/a/Library/App/",
	temp: "/tmp",
	resources: "/App/Resources",
};

describe("shell integration paths", () => {
	it("keeps the zsh shim in its own folder", () => {
		expect(zshIntegrationDir(paths)).toBe("/Users/a/Library/App/terminal-shell-integration/zsh");
	});
});
