// @vitest-environment node
/**
 * @feature RUN-09 Zsh shell integration for terminals
 * Owns: tests that run the shim files in a real interactive zsh, in a home folder of the test's
 * own, and read the OSC 633 markers it prints: with no user dotfiles, with a user `.zshrc`, and
 * with a user `.zshenv` that moves `ZDOTDIR` to another folder, and with a `ZDOTDIR` the app was
 * launched with.
 * Behaviour: native-and-sidecar-map.md A5 (the shim sources the user's own dotfiles, then prints
 * the markers) and services-map.md 5A.4.6.
 * Test first: a user whose `.zshenv` sets `ZDOTDIR` to `~/.config/zsh` gets that folder's `.zshrc`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ShellIntegrationEvent,
	scanShellIntegration,
	shellIntegrationEnv,
	ZSH_INTEGRATION_FILE_NAMES,
	zshIntegrationFiles,
} from "./terminals.ts";

const ZSH = "/bin/zsh";
const made: string[] = [];

afterEach(() => {
	// Only the folders this file made under the run's own temp folder.
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A home folder and a shim folder holding the app's four shim files. */
function setup(): { home: string; shim: string } {
	const base = mkdtempSync(join(tmpdir(), "run-09-zsh-"));
	made.push(base);
	const home = join(base, "home");
	const shim = join(base, "app-data", "terminal-shell-integration", "zsh");
	mkdirSync(home, { recursive: true });
	mkdirSync(shim, { recursive: true });
	const files = zshIntegrationFiles();
	for (const name of ZSH_INTEGRATION_FILE_NAMES) writeFileSync(join(shim, name), files[name]);
	return { home, shim };
}

/**
 * Runs the lines in an interactive zsh started the way a terminal tab starts it. `launchZdotdir`
 * is the `ZDOTDIR` the app was launched with, or null.
 */
function runZsh(
	home: string,
	shim: string,
	lines: string[],
	launchZdotdir: string | null = null,
): { stdout: string; events: ShellIntegrationEvent[] } {
	const result = spawnSync(ZSH, ["-i"], {
		input: `${lines.join("\n")}\nexit\n`,
		env: {
			HOME: home,
			PATH: "/usr/bin:/bin",
			TERM: "dumb",
			...shellIntegrationEnv(shim, launchZdotdir),
		},
		encoding: "utf8",
		timeout: 20_000,
	});
	if (result.error !== undefined) throw result.error;
	return { stdout: result.stdout, events: scanShellIntegration("", result.stdout).events };
}

describe("RUN-09 the shim in a real zsh", () => {
	it("prints a prompt, the program and its exit code for each command", () => {
		const { home, shim } = setup();

		const { events } = runZsh(home, shim, ["true", "false"]);

		expect(events).toEqual([
			{ kind: "prompt" },
			{ kind: "program_start", program: "true" },
			{ kind: "command_done", exitCode: 0 },
			{ kind: "prompt" },
			{ kind: "program_start", program: "false" },
			{ kind: "command_done", exitCode: 1 },
			{ kind: "prompt" },
			{ kind: "program_start", program: "exit" },
		]);
	});

	it("loads the user's own .zshrc from their home folder before the markers", () => {
		const { home, shim } = setup();
		writeFileSync(join(home, ".zshrc"), "echo home-zshrc-loaded\nalias greet='echo hi'\n");

		const { stdout, events } = runZsh(home, shim, ["greet"]);

		expect(stdout).toContain("home-zshrc-loaded");
		expect(stdout.indexOf("home-zshrc-loaded")).toBeLessThan(stdout.indexOf("]633;"));
		expect(stdout).toContain("hi\n");
		expect(events).toContainEqual({ kind: "program_start", program: "greet" });
	});

	it("follows a ZDOTDIR the user's .zshenv sets to find the rest of their dotfiles", () => {
		const { home, shim } = setup();
		const custom = join(home, ".config", "zsh");
		mkdirSync(custom, { recursive: true });
		writeFileSync(join(home, ".zshenv"), 'export ZDOTDIR="$HOME/.config/zsh"\n');
		writeFileSync(join(custom, ".zshrc"), "echo custom-zshrc-loaded\n");
		writeFileSync(join(home, ".zshrc"), "echo wrong-zshrc-loaded\n");

		const { stdout, events } = runZsh(home, shim, ["true"]);

		expect(stdout).toContain("custom-zshrc-loaded");
		expect(stdout).not.toContain("wrong-zshrc-loaded");
		expect(events).toContainEqual({ kind: "command_done", exitCode: 0 });
	});

	it("reads the dotfiles from a ZDOTDIR the app was launched with", () => {
		const { home, shim } = setup();
		const custom = join(home, "dotfiles");
		mkdirSync(custom, { recursive: true });
		writeFileSync(join(custom, ".zshenv"), "echo launch-zshenv-loaded\n");
		writeFileSync(join(custom, ".zshrc"), "echo launch-zshrc-loaded\n");
		writeFileSync(join(home, ".zshenv"), "echo home-zshenv-loaded\n");
		writeFileSync(join(home, ".zshrc"), "echo home-zshrc-loaded\n");

		const { stdout, events } = runZsh(home, shim, ["echo $CONDUCTED_USER_ZDOTDIR-left"], custom);

		expect(stdout).toContain("launch-zshenv-loaded");
		expect(stdout).toContain("launch-zshrc-loaded");
		expect(stdout).not.toContain("home-zshenv-loaded");
		expect(stdout).not.toContain("home-zshrc-loaded");
		// The hand-over variable does not leak into the user's commands.
		expect(stdout).toContain("-left");
		expect(stdout).not.toContain(`${custom}-left`);
		expect(events).toContainEqual({ kind: "prompt" });
	});
});
