/**
 * @feature CHAT-23 Run button on shell code blocks
 * Owns: tests for the live output, status mark, exit code, Stop command and Clear output under a
 * shell code block.
 * Behaviour: inventory text R@8061041 (Run on shell blocks), ui-map.md 3.3.
 * Test first: output the command writes appears under the block, and its exit code replaces Running.
 */
import { ok, type TerminalId, type WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Terminal, TerminalConnection, TerminalUnsubscribe } from "../../core/model.ts";

const state = vi.hoisted(() => ({
	runCommand: vi.fn(),
	close: vi.fn(),
	copyText: vi.fn(),
	connection: { state: "loading" } as Loadable<TerminalConnection>,
}));

// seam: CHAT-23 the PTY stream comes from Rust; this test feeds and ends it directly
vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({
		terminals: { runCommand: state.runCommand, close: state.close },
		app: { copyText: state.copyText },
	}),
	useTerminalConnection: () => state.connection,
}));

const { CodeBlock } = await import("./CodeBlock.tsx");

const terminalId = "term-1" as TerminalId;
const workspaceId = "w1" as WorkspaceId;

function fakeConnection() {
	const dataListeners = new Set<(chunk: Uint8Array) => void>();
	const exitListeners = new Set<(exitCode: number | null) => void>();
	const connection: TerminalConnection & {
		emit(text: string): void;
		exit(exitCode: number | null): void;
		watching(): boolean;
	} = {
		history: new Uint8Array(),
		ended: null,
		write: async () => ok(undefined),
		resize: async () => ok(undefined),
		ack: () => {},
		onData: (listener): TerminalUnsubscribe => {
			dataListeners.add(listener);
			return () => dataListeners.delete(listener);
		},
		onExit: (listener): TerminalUnsubscribe => {
			exitListeners.add(listener);
			return () => exitListeners.delete(listener);
		},
		emit: (text) => {
			const chunk = new TextEncoder().encode(text);
			for (const listener of [...dataListeners]) listener(chunk);
		},
		exit: (exitCode) => {
			for (const listener of [...exitListeners]) listener(exitCode);
		},
		watching: () => dataListeners.size > 0 && exitListeners.size > 0,
	};
	return connection;
}

function renderBlock(
	ui: ReactElement = (
		<CodeBlock code={"echo hi"} language={"bash"} workspaceId={workspaceId} canRun />
	),
) {
	return render(ui);
}

async function startRun(connection: ReturnType<typeof fakeConnection>) {
	fireEvent.click(screen.getByRole("button", { name: "Run" }));
	await waitFor(() => expect(state.runCommand).toHaveBeenCalledWith(workspaceId, "echo hi"));
	await waitFor(() => expect(connection.watching()).toBe(true));
}

beforeEach(() => {
	state.runCommand.mockReset();
	state.runCommand.mockResolvedValue(ok({ id: terminalId } as Terminal));
	state.close.mockReset();
	state.close.mockResolvedValue(ok(undefined));
	state.copyText.mockReset();
	state.connection = { state: "loading" };
});

afterEach(cleanup);

describe("CHAT-23 shell code block output", () => {
	it("shows the live output and the exit code, and clears the output", async () => {
		const connection = fakeConnection();
		state.connection = { state: "ready", data: connection };
		renderBlock();
		await startRun(connection);

		expect(screen.getByText("Running")).toBeTruthy();
		expect(document.querySelector('[data-run-status="running"]')).toBeTruthy();

		act(() => connection.emit("hello from the command\n"));
		expect(screen.getByText(/hello from the command/)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Clear output" }));
		expect(screen.queryByText(/hello from the command/)).toBeNull();

		act(() => connection.exit(0));
		expect(screen.getByText("Done")).toBeTruthy();
		expect(screen.getByText("Exit code 0")).toBeTruthy();
	});

	it("shows Failed with a non-zero exit code", async () => {
		const connection = fakeConnection();
		state.connection = { state: "ready", data: connection };
		renderBlock();
		await startRun(connection);

		act(() => connection.emit("the command failed\n"));
		act(() => connection.exit(2));

		expect(screen.getByText("Failed")).toBeTruthy();
		expect(screen.getByText("Exit code 2")).toBeTruthy();
		expect(document.querySelector('[data-run-status="failed"]')).toBeTruthy();
	});

	it("stops a running command and names the stop", async () => {
		const connection = fakeConnection();
		state.connection = { state: "ready", data: connection };
		renderBlock();
		await startRun(connection);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Stop command" }));
			await Promise.resolve();
		});
		expect(state.close).toHaveBeenCalledWith(terminalId);

		act(() => connection.exit(null));
		expect(screen.getByText("Stopped")).toBeTruthy();
		expect(screen.queryByText("Stop command")).toBeNull();
	});
});
