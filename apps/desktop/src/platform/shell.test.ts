/**
 * @feature PLAT-03 Shell commands: run, start, cancel
 * Owns: the Tauri shell door's tests: command arguments, the done event and cancel.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 and frontend.md 3a.
 */

import { describe, expect, it, vi } from "vitest";
import type { ShellCommand, ShellOutput } from "./platform.ts";
import { COMMANDS, createTauriShell, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

interface DonePayload {
	id: string;
	output: ShellOutput | null;
	error: { code: string; message: string } | null;
}

const command: ShellCommand = {
	program: "git",
	args: ["status", "--short"],
	cwd: "/tmp/workspace",
};

describe("PLAT-03 the Tauri shell door", () => {
	it("PLAT-03 sends shell_run the command and returns its output", async () => {
		const calls: Call[] = [];
		const output = { exitCode: 0, stdout: "clean", stderr: "" };
		const bindings: TauriBindings = {
			invoke: async <T>(commandName: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command: commandName, args });
				return output as T;
			},
			listen: async () => () => {},
		};

		const shell = createTauriShell(bindings);
		const result = await shell.run(command);

		expect(result).toEqual({ ok: true, value: output });
		expect(calls).toEqual([{ command: COMMANDS.shellRun, args: { command } }]);
	});

	it("PLAT-03 starts a command and resolves done from the shell://done event", async () => {
		const calls: Call[] = [];
		const state: { listener: ((payload: DonePayload) => void) | null } = { listener: null };
		let started!: () => void;
		const startCalled = new Promise<void>((resolve) => {
			started = resolve;
		});
		const bindings: TauriBindings = {
			invoke: async <T>(commandName: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command: commandName, args });
				if (commandName === COMMANDS.shellStart) started();
				return undefined as T;
			},
			listen: async <T>(_event: string, handler: (payload: T) => void) => {
				state.listener = handler as (payload: DonePayload) => void;
				return () => {
					state.listener = null;
				};
			},
		};

		const shell = createTauriShell(bindings);
		const running = shell.start(command);
		await startCalled;

		expect(state.listener).not.toBeNull();
		expect(calls).toContainEqual({
			command: COMMANDS.shellStart,
			args: { id: running.id, command },
		});

		const done: DonePayload = {
			id: running.id,
			output: { exitCode: 0, stdout: "finished", stderr: "" },
			error: null,
		};
		(state.listener as ((payload: DonePayload) => void) | null)?.(done);

		await expect(running.done).resolves.toEqual({
			ok: true,
			value: { exitCode: 0, stdout: "finished", stderr: "" },
		});
	});

	it("PLAT-03 resolves done with the error the shell reported", async () => {
		const state: { listener: ((payload: DonePayload) => void) | null } = { listener: null };
		let started!: () => void;
		const startCalled = new Promise<void>((resolve) => {
			started = resolve;
		});
		const bindings: TauriBindings = {
			invoke: async <T>(commandName: string): Promise<T> => {
				if (commandName === COMMANDS.shellStart) started();
				return undefined as T;
			},
			listen: async <T>(_event: string, handler: (payload: T) => void) => {
				state.listener = handler as (payload: DonePayload) => void;
				return () => {
					state.listener = null;
				};
			},
		};

		const shell = createTauriShell(bindings);
		const running = shell.start(command);
		await startCalled;

		(state.listener as ((payload: DonePayload) => void) | null)?.({
			id: running.id,
			output: null,
			error: { code: "shell_cancelled", message: "The command was cancelled." },
		});

		await expect(running.done).resolves.toEqual({
			ok: false,
			error: { code: "shell_cancelled", message: "The command was cancelled." },
		});
	});

	it("PLAT-03 cancels through shell_cancel", async () => {
		const calls: Call[] = [];
		let started!: () => void;
		const startCalled = new Promise<void>((resolve) => {
			started = resolve;
		});
		const bindings: TauriBindings = {
			invoke: async <T>(commandName: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command: commandName, args });
				if (commandName === COMMANDS.shellStart) started();
				return undefined as T;
			},
			listen: async () => () => {},
		};

		const shell = createTauriShell(bindings);
		const running = shell.start(command);
		await startCalled;
		await running.cancel();

		expect(calls).toContainEqual({
			command: COMMANDS.shellCancel,
			args: { id: running.id },
		});
	});

	it("PLAT-03 listens again after the first listen call failed", async () => {
		let listenCalls = 0;
		let startCalls = 0;
		const state: { listener: ((payload: DonePayload) => void) | null } = { listener: null };
		const bindings: TauriBindings = {
			invoke: async <T>(commandName: string): Promise<T> => {
				if (commandName === COMMANDS.shellStart) startCalls++;
				return undefined as T;
			},
			listen: async <T>(_event: string, handler: (payload: T) => void) => {
				listenCalls++;
				if (listenCalls === 1) throw new Error("no event bus");
				state.listener = handler as (payload: DonePayload) => void;
				return () => {};
			},
		};
		const shell = createTauriShell(bindings);

		const failed = await shell.start(command).done;
		expect(failed).toMatchObject({ ok: false, error: { code: "tauri_error" } });

		const running = shell.start(command);
		await vi.waitFor(() => expect(startCalls).toBe(1));
		state.listener?.({
			id: running.id,
			output: { exitCode: 0, stdout: "", stderr: "" },
			error: null,
		});
		await expect(running.done).resolves.toMatchObject({ ok: true });
	});
});
