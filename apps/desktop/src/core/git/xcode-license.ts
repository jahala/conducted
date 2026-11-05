/**
 * @feature GIT-16 Explain a blocked git (Xcode licence) and offer the fix
 * Owns: asking macOS whether the Xcode licence blocks command-line tools, the text and timing of
 * the notice, and the one action that accepts the licence in a Terminal window.
 * Behaviour: services-map.md 5A.8.1 (the "Run for me" action runs `sudo xcodebuild -license
 * accept`), ui-map.md 7.4 (the toast), inventory toast row 531 (title, description, 15 seconds,
 * "Run for me").
 * Must handle: a Mac whose licence is accepted (nothing is blocked); a probe that could not run
 * (the failure is handed back, never reported as accepted); a licence text in any case.
 * Our design choice: the probe is `xcodebuild -license check`, so it needs no password, and the
 * fix opens the user's own Terminal through osascript, where sudo can ask for the password.
 * Test first: a failed `xcodebuild -license check` with the licence text is blocked; the fix
 * opens Terminal with the accept command.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Shell } from "../../platform/platform.ts";
import { isXcodeLicenseError, xcodeLicenseToast } from "./runner.ts";

export const XCODE_LICENSE_CHECK_ARGS = ["-license", "check"] as const;
export const XCODE_LICENSE_ACCEPT_COMMAND = "sudo xcodebuild -license accept";
/** The toast id Conductor uses, so a second start replaces the notice instead of stacking it. */
export const XCODE_LICENSE_TOAST_ID = "xcode-license-blocking-git";
export const XCODE_LICENSE_TOAST_DESCRIPTION = `Run \`${XCODE_LICENSE_ACCEPT_COMMAND}\` in terminal to continue`;

/** Whether a failed check's text is the Xcode licence prompt. A successful check is never blocked. */
export const xcodeLicenseBlocks = (exitCode: number, output: string): boolean =>
	exitCode !== 0 && isXcodeLicenseError(output);

/** Runs the password-free probe. A probe that could not run is returned as a failure. */
export async function checkXcodeLicense(
	shell: Pick<Shell, "run">,
	cwd: string,
): Promise<Result<boolean>> {
	const result = await shell.run({
		program: "xcodebuild",
		args: [...XCODE_LICENSE_CHECK_ARGS],
		cwd,
	});
	if (!result.ok) return result;
	return ok(
		xcodeLicenseBlocks(result.value.exitCode, `${result.value.stdout}\n${result.value.stderr}`),
	);
}

/** Quotes a command for an AppleScript `do script` string. */
const appleScriptString = (value: string): string =>
	value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/** The osascript arguments that open Terminal and run one command in a new window. */
export const xcodeLicenseTerminalArgs = (
	command: string = XCODE_LICENSE_ACCEPT_COMMAND,
): readonly string[] => [
	"-e",
	'tell application "Terminal"',
	"-e",
	"activate",
	"-e",
	`do script "${appleScriptString(command)}"`,
	"-e",
	"end tell",
];

/** Opens Terminal and runs the accept command, where sudo can ask the user for a password. */
export async function openXcodeLicenseTerminal(
	shell: Pick<Shell, "run">,
	cwd: string,
): Promise<Result<void>> {
	const result = await shell.run({
		program: "osascript",
		args: [...xcodeLicenseTerminalArgs()],
		cwd,
	});
	if (!result.ok) {
		return err(
			appError(
				"xcode_license_fix_failed",
				"Couldn't open Terminal to accept the Xcode license.",
				result.error,
			),
		);
	}
	if (result.value.exitCode !== 0) {
		return err(
			appError("xcode_license_fix_failed", "Couldn't open Terminal to accept the Xcode license."),
		);
	}
	return ok(undefined);
}

/** The options of the notice toast: its stable id, 15 seconds, the explanation and one action. */
export const xcodeLicenseToastOptions = (
	onFix: () => void,
): {
	id: string;
	duration: number;
	description: string;
	action: { label: string; onClick: () => void };
} => {
	const spec = xcodeLicenseToast();
	return {
		id: XCODE_LICENSE_TOAST_ID,
		duration: spec.durationMs,
		description: XCODE_LICENSE_TOAST_DESCRIPTION,
		action: { label: spec.actionLabel, onClick: onFix },
	};
};
