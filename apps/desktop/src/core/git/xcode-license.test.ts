import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ShellCommand, ShellOutput } from "../../platform/platform.ts";
import {
	checkXcodeLicense,
	openXcodeLicenseTerminal,
	XCODE_LICENSE_ACCEPT_COMMAND,
	XCODE_LICENSE_CHECK_ARGS,
	XCODE_LICENSE_TOAST_DESCRIPTION,
	XCODE_LICENSE_TOAST_ID,
	xcodeLicenseTerminalArgs,
	xcodeLicenseToastOptions,
} from "./xcode-license.ts";

const shellWith = (
	answer: (command: ShellCommand) => { exitCode: number; stdout?: string; stderr?: string } | null,
) => {
	const calls: ShellCommand[] = [];
	return {
		calls,
		shell: {
			run: async (command: ShellCommand) => {
				calls.push(command);
				const value = answer(command);
				if (value === null) return err(appError("process_spawn", "xcodebuild is not installed"));
				const output: ShellOutput = {
					exitCode: value.exitCode,
					stdout: value.stdout ?? "",
					stderr: value.stderr ?? "",
				};
				return ok(output);
			},
			start: () => {
				throw new Error("not used");
			},
			loginEnv: async () => ({ shell: "/bin/zsh", path: "/usr/bin", zdotdir: null }),
		},
	};
};

describe("GIT-16 Xcode licence check", () => {
	it("asks xcodebuild whether the licence is accepted", async () => {
		const scripted = shellWith(() => ({ exitCode: 1, stderr: "You have not agreed." }));

		const blocked = await checkXcodeLicense(scripted.shell, "/Users/me");

		expect(blocked.ok).toBe(true);
		expect(scripted.calls[0]).toEqual({
			program: "xcodebuild",
			args: [...XCODE_LICENSE_CHECK_ARGS],
			cwd: "/Users/me",
		});
	});

	it("explains a fresh Mac that has not accepted the licence", async () => {
		const scripted = shellWith(() => ({
			exitCode: 1,
			stderr: "You have not agreed to the Xcode license agreements.",
		}));

		const blocked = await checkXcodeLicense(scripted.shell, "/Users/me");

		expect(blocked.ok && blocked.value).toBe(true);
	});

	it("says nothing is blocked when xcodebuild exits successfully", async () => {
		const scripted = shellWith(() => ({ exitCode: 0 }));

		const blocked = await checkXcodeLicense(scripted.shell, "/Users/me");

		expect(blocked.ok && blocked.value).toBe(false);
	});

	it("does not call another tool failing to start a licence problem", async () => {
		const scripted = shellWith(() => ({
			exitCode: 72,
			stderr: "xcode-select: error: tool 'xcodebuild' requires Xcode.",
		}));

		const blocked = await checkXcodeLicense(scripted.shell, "/Users/me");

		expect(blocked.ok && blocked.value).toBe(false);
	});

	it("hands a probe that could not run back as a failure", async () => {
		const shell = shellWith(() => null).shell;

		const blocked = await checkXcodeLicense(shell, "/Users/me");

		expect(blocked.ok).toBe(false);
	});
});

describe("GIT-16 Xcode licence toast", () => {
	it("keeps the Conductor title, 15 seconds and one action", () => {
		const onFix = vi.fn();
		const options = xcodeLicenseToastOptions(onFix);

		expect(options.id).toBe(XCODE_LICENSE_TOAST_ID);
		expect(options.duration).toBe(15_000);
		expect(options.description).toBe(
			"Run `sudo xcodebuild -license accept` in terminal to continue",
		);
		expect(options.action.label).toBe("Run for me");
		options.action.onClick();
		expect(onFix).toHaveBeenCalledOnce();
		expect(XCODE_LICENSE_TOAST_DESCRIPTION).toContain(XCODE_LICENSE_ACCEPT_COMMAND);
	});
});

describe("GIT-16 Xcode licence fix", () => {
	it("opens Terminal with the accept command", async () => {
		const scripted = shellWith((command) =>
			command.program === "osascript" ? { exitCode: 0 } : null,
		);

		const result = await openXcodeLicenseTerminal(scripted.shell, "/Users/me");

		expect(result.ok).toBe(true);
		const call = scripted.calls[0];
		expect(call?.program).toBe("osascript");
		expect(call?.args).toEqual(xcodeLicenseTerminalArgs());
		expect(call?.args).toContain(`do script "${XCODE_LICENSE_ACCEPT_COMMAND}"`);
	});

	it("reports Terminal refusing the command", async () => {
		const scripted = shellWith(() => ({ exitCode: 1, stderr: "Not authorized" }));

		const result = await openXcodeLicenseTerminal(scripted.shell, "/Users/me");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("xcode_license_fix_failed");
	});
});
