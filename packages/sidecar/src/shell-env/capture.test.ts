import { expect, test } from "bun:test";
import { captureCommandFor, fallbackCaptureCommand } from "./capture.ts";

test("zsh and bash use -ilc and print env between the marker", () => {
	const cmd = captureCommandFor("/bin/zsh", "MK");
	expect(cmd.command).toBe("/bin/zsh");
	expect(cmd.args[0]).toBe("-ilc");
	expect(cmd.args[1]).toBe("printf '%s' 'MK'; env -0; printf '%s' 'MK'");
});

test("fish uses its own flag spelling", () => {
	expect(captureCommandFor("/opt/homebrew/bin/fish", "MK").args.slice(0, 3)).toEqual([
		"-i",
		"-l",
		"-c",
	]);
});

test("the fallback is a login zsh without the interactive flag", () => {
	expect(fallbackCaptureCommand("MK").args[0]).toBe("-lc");
});
