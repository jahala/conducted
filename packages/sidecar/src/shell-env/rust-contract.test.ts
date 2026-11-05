import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureCommandFor, fallbackCaptureCommand } from "./capture.ts";
import { STRIPPED_ENV_NAMES, STRIPPED_ENV_PREFIXES } from "./env.ts";

const rustSource = readFileSync(
	join(import.meta.dir, "../../../../apps/desktop/src-tauri/src/shell.rs"),
	"utf8",
);

function quotedStrings(block: string, pattern: RegExp): string[] {
	return Array.from(block.matchAll(pattern), (match) => match[1] ?? "");
}

describe("SIDE-10 Rust and sidecar contract", () => {
	test("both sides strip the same environment names and prefixes", () => {
		const namesBlock =
			/pub const STRIPPED_ENV_NAMES: &\[&str\] = &\[([\s\S]*?)\];/.exec(rustSource)?.[1] ?? "";
		const prefixesBlock =
			/pub const STRIPPED_ENV_PREFIXES: &\[&str\] = &\[([\s\S]*?)\];/.exec(rustSource)?.[1] ?? "";
		const rustNames = quotedStrings(namesBlock, /"([A-Z0-9_]+)"/g);
		const rustPrefixes = quotedStrings(prefixesBlock, /"([A-Z0-9_]+)"/g);

		expect([...rustNames].sort()).toEqual([...STRIPPED_ENV_NAMES].sort());
		expect([...rustPrefixes].sort()).toEqual([...STRIPPED_ENV_PREFIXES].sort());
	});

	test("both sides launch the login shell with the same flags", () => {
		const rustPrimary = /pub fn capture_command_for[\s\S]*?\n\}/.exec(rustSource)?.[0] ?? "";
		const rustFallback = /fn fallback_capture_command_at[\s\S]*?\n\}/.exec(rustSource)?.[0] ?? "";
		const rustFlags = quotedStrings(rustPrimary, /"(-[a-z]+)"/g);
		const rustFallbackFlags = quotedStrings(rustFallback, /"(-[a-z]+)"/g);

		const zsh = captureCommandFor("/bin/zsh", "M");
		const bash = captureCommandFor("/bin/bash", "M");
		const fish = captureCommandFor("/bin/fish", "M");

		expect(rustFlags).toContain(zsh.args[0] ?? "");
		expect(rustFlags).toContain(bash.args[0] ?? "");
		expect(rustFlags).toEqual(expect.arrayContaining(fish.args.slice(0, 3)));
		expect(rustFallbackFlags).toContain(fallbackCaptureCommand("M").args[0] ?? "");
	});

	test("both sides read the same env -0 dump between two markers", () => {
		const rustScript =
			/fn capture_script\(marker: &str\) -> String \{[\s\S]*?format!\(\s*"([\s\S]*?)"\s*\)/.exec(
				rustSource,
			)?.[1] ?? "";
		const framing = "printf '%s' '{marker}'; env -0; printf '%s' '{marker}'";

		expect(rustScript).toContain(framing);
		expect(captureCommandFor("/bin/zsh", "{marker}").args[1]).toBe(framing);
		expect(fallbackCaptureCommand("{marker}").args[1]).toBe(framing);
	});
});
