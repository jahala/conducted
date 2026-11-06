import { describe, expect, test } from "bun:test";
import { createLogger } from "../logging/logger.ts";
import { loginShellOver } from "./login-shell.ts";

const logger = createLogger({
	sink: () => {},
	clock: { now: () => 0 },
	level: "error",
	scope: "test",
});

describe("test support: the real login-shell capture over a scripted shell", () => {
	test("keeps a provider key out of the environment", async () => {
		const shell = loginShellOver({ PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-mac" }, logger);

		const captured = await shell.get("/work/lisbon");

		expect(captured.ok).toBe(true);
		if (!captured.ok) return;
		expect(captured.value.env.PATH).toBe("/usr/bin");
		expect(captured.value.env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(captured.value.providerSecrets).toEqual({ ANTHROPIC_API_KEY: "sk-mac" });
	});
});
