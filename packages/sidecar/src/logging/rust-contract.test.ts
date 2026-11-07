import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	KEYBOARD_NAME_WORDS,
	SECRET_NAME_KEY_WORD,
	SECRET_NAME_PREFIX,
	SECRET_NAME_QUALIFIED_WORDS,
	SECRET_NAME_WORDS,
} from "@conducted/shared";

const rustSource = readFileSync(
	join(import.meta.dir, "../../../../apps/desktop/src-tauri/src/logger.rs"),
	"utf8",
);

function quotedStrings(block: string): string[] {
	return Array.from(block.matchAll(/"([^"]*)"/g), (match) => match[1] ?? "");
}

function rustList(name: string): string[] {
	const block = new RegExp(
		`pub const ${name}\\s*:\\s*&\\[&str\\]\\s*=\\s*&\\[([\\s\\S]*?)\\];`,
	).exec(rustSource)?.[1];
	return quotedStrings(block ?? "").sort();
}

function rustString(name: string): string {
	return (
		new RegExp(`pub const ${name}\\s*:\\s*&str\\s*=\\s*"([^"]*)";`).exec(rustSource)?.[1] ?? ""
	);
}

describe("PLAT-18 SIDE-18 Rust and shared secret-name contract", () => {
	test("the Rust logger declares the same secret-name words as the shared rule", () => {
		expect(rustList("SECRET_NAME_WORDS")).toEqual([...SECRET_NAME_WORDS].sort());
		expect(rustList("SECRET_NAME_QUALIFIED_WORDS")).toEqual(
			[...SECRET_NAME_QUALIFIED_WORDS].sort(),
		);
		expect(rustList("KEYBOARD_NAME_WORDS")).toEqual([...KEYBOARD_NAME_WORDS].sort());
		expect(rustString("SECRET_NAME_KEY_WORD")).toBe(SECRET_NAME_KEY_WORD);
		expect(rustString("SECRET_NAME_PREFIX")).toBe(SECRET_NAME_PREFIX);
	});
});
