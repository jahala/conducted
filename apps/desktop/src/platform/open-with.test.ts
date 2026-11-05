/**
 * @feature PLAT-19 Detect installed editors and terminals for "Open in"
 * Owns: tests for the Tauri opener methods that call the Rust shell's open_with commands.
 * Behaviour: docs/plans/tauri-commands.md.
 */

import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriOpener, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

function bindings(handler: (command: string, args?: Record<string, unknown>) => unknown): {
	bindings: TauriBindings;
	calls: Call[];
} {
	const calls: Call[] = [];
	return {
		calls,
		bindings: {
			invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command, args });
				return handler(command, args) as T;
			},
			listen: async () => () => {},
		},
	};
}

describe("PLAT-19 Tauri opener", () => {
	it("PLAT-19 sends reveal, open and detection to the shell", async () => {
		const fake = bindings((command) => {
			if (command === COMMANDS.installedApps) return ["Finder", "Cursor"];
			return undefined;
		});
		const opener = createTauriOpener(fake.bindings);

		await opener.revealInFinder("/work/note.txt");
		const opened = await opener.openWith("Cursor", "/work/note.txt");
		const installed = await opener.installedApps();

		expect(opened).toEqual({ ok: true, value: undefined });
		expect(installed).toEqual(["Finder", "Cursor"]);
		expect(fake.calls).toEqual([
			{ command: COMMANDS.revealInFinder, args: { path: "/work/note.txt" } },
			{ command: COMMANDS.openWith, args: { appName: "Cursor", path: "/work/note.txt" } },
			{ command: COMMANDS.installedApps, args: undefined },
		]);
	});

	it("PLAT-19 turns a refused open into an Err", async () => {
		const fake = bindings(() => {
			throw { code: "open_with_not_installed", message: "Cursor is not installed." };
		});
		const opener = createTauriOpener(fake.bindings);

		const result = await opener.openWith("Cursor", "/work");

		expect(result).toEqual({
			ok: false,
			error: { code: "open_with_not_installed", message: "Cursor is not installed." },
		});
	});
});
