/**
 * @feature PLAT-22 The window.open guard the Rust shell injects
 * Owns: a JavaScript test of OPEN_WINDOW_SHIM in src-tauri/src/navigation.rs. The Rust tests check
 * the navigation decision; the script itself runs only in the web view, so this test reads it from
 * the Rust source and runs it in jsdom, the way the web view runs it after each page load.
 * Behaviour: native-and-sidecar-map.md A2 (external links open in the browser).
 * Test first: window.open of a web address on another origin goes to the opener plugin and returns
 * null; an address on the app's own origin goes to the original window.open.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Under jsdom `import.meta.url` is not a file URL, so the file is found from the working folder
// (the desktop package or the repository root), as test/sqlite.ts finds the migrations.
const RUST_FILE =
	[
		resolve(process.cwd(), "src-tauri/src/navigation.rs"),
		resolve(process.cwd(), "apps/desktop/src-tauri/src/navigation.rs"),
	].find((path) => existsSync(path)) ?? resolve(process.cwd(), "src-tauri/src/navigation.rs");
const RUST = readFileSync(RUST_FILE, "utf8");

/** The script between `const OPEN_WINDOW_SHIM: &str = r#"` and its closing `"#;`. */
function shimSource(): string {
	const found = /const OPEN_WINDOW_SHIM: &str = r#"([\s\S]*?)"#;/.exec(RUST)?.[1];
	if (found === undefined) throw new Error("OPEN_WINDOW_SHIM was not found in navigation.rs");
	return found;
}

type TauriWindow = Window & { __TAURI_INTERNALS__?: { invoke: (...args: unknown[]) => unknown } };

const original = window.open;

afterEach(() => {
	window.open = original;
	delete (window as TauriWindow).__TAURI_INTERNALS__;
});

function install() {
	const invoke = vi.fn();
	const opened = vi.fn(() => null);
	(window as TauriWindow).__TAURI_INTERNALS__ = { invoke };
	window.open = opened as unknown as typeof window.open;
	// The web view evaluates the same text after each page load (navigation.rs install_guard).
	new Function(shimSource())();
	return { invoke, opened };
}

describe("PLAT-22 window.open guard", () => {
	it("sends a web address on another origin to the browser and opens no window", () => {
		const { invoke, opened } = install();

		const result = window.open("https://example.com/docs", "_blank");

		expect(result).toBeNull();
		expect(invoke).toHaveBeenCalledWith("plugin:opener|open_url", {
			url: "https://example.com/docs",
		});
		expect(opened).not.toHaveBeenCalled();
	});

	it("leaves an address on the app's own origin and other schemes to the original window.open", () => {
		const { invoke, opened } = install();

		window.open(`${window.location.origin}/settings`);
		window.open("mailto:someone@example.com");

		expect(invoke).not.toHaveBeenCalled();
		expect(opened).toHaveBeenCalledTimes(2);
		expect(opened).toHaveBeenNthCalledWith(1, `${window.location.origin}/settings`);
	});
});
