import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriShell } from "./tauri.ts";

describe("PLAT-04 login-shell environment", () => {
	it("asks the Rust shell for the login shell, PATH and launch ZDOTDIR", async () => {
		const calls: string[] = [];
		const shell = createTauriShell({
			invoke: async (command) => {
				calls.push(command);
				return {
					shell: "/bin/zsh",
					path: "/opt/homebrew/bin:/usr/bin:/bin",
					zdotdir: "/Users/me/.config/zsh",
				} as never;
			},
			listen: async () => () => {},
		});

		await expect(shell.loginEnv()).resolves.toEqual({
			shell: "/bin/zsh",
			path: "/opt/homebrew/bin:/usr/bin:/bin",
			zdotdir: "/Users/me/.config/zsh",
		});
		expect(calls).toEqual([COMMANDS.shellLoginEnv]);
	});

	it("throws when the Rust shell could not capture the environment", async () => {
		const shell = createTauriShell({
			invoke: async () => {
				throw { code: "login_env_failed", message: "The login shell printed no marker." };
			},
			listen: async () => () => {},
		});

		await expect(shell.loginEnv()).rejects.toMatchObject({ code: "login_env_failed" });
	});
});
