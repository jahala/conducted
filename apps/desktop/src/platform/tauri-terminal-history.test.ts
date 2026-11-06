// @vitest-environment node
/**
 * @feature PLAT-08 Saved terminal scrollback
 * Owns: tests that the Tauri terminal door asks the shell for a terminal's saved history and
 * turns the base64 answer back into bytes.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A2
 * (`pty_load_terminal_history`) and docs/plans/tauri-commands.md (`pty_load_history`).
 */
import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriPty, type TauriBindings } from "./tauri.ts";

interface Harness {
	bindings: TauriBindings;
	calls: { command: string; args?: Record<string, unknown> }[];
}

function harness(answer: unknown): Harness {
	const calls: Harness["calls"] = [];
	const bindings: TauriBindings = {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
			calls.push({ command, args });
			if (answer instanceof Error) throw answer;
			return answer as T;
		},
		listen: async () => () => {},
	};
	return { bindings, calls };
}

describe("PLAT-08 Tauri saved terminal scrollback", () => {
	it("asks for the saved history by terminal id and decodes the base64 answer", async () => {
		const h = harness("aGVsbG8=");
		const result = await createTauriPty(h.bindings).loadHistory("pty-1");
		if (!result.ok) throw new Error(`loadHistory failed: ${result.error.message}`);

		expect([...result.value]).toEqual([104, 101, 108, 108, 111]);
		expect(h.calls).toEqual([{ command: COMMANDS.ptyLoadHistory, args: { terminalId: "pty-1" } }]);
	});

	it("returns the shell's error unchanged when no history exists", async () => {
		const h = harness(new Error("no saved history"));
		const result = await createTauriPty(h.bindings).loadHistory("pty-missing");
		if (result.ok) throw new Error("expected an error");

		expect(result.error.code).toBe("tauri_error");
		expect(h.calls[0]?.command).toBe(COMMANDS.ptyLoadHistory);
	});
});
