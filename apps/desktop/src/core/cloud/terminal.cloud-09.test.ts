// @vitest-environment node
/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Tests the desktop's half of a cloud terminal: it opens the Worker's terminal stream with its
 * start message, carries input and resize out and output, exit and a lost connection back.
 * Behaviour: cloud-and-remote.md Part 1 point 7 (the sandbox's PTY terminal over a WebSocket).
 */

import type { Host } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { cloudMemoryPlatform } from "../../test/memory-platform.ts";
import { openCloudTerminal } from "./terminal.ts";

const HOST: Extract<Host, { kind: "cloud" }> = {
	kind: "cloud",
	url: "https://conducted.example.workers.dev",
	vmId: "oslo",
};

const base64 = (text: string): string => btoa(text);

/** The last message of `type` the app sent on one relay. */
function sent(
	memory: ReturnType<typeof cloudMemoryPlatform>,
	type: string,
): { [key: string]: unknown } | null {
	for (const entry of [...memory.controls.cloudSent].reverse()) {
		const parsed = JSON.parse(entry.line) as { type?: string };
		if (parsed.type === type) return parsed as { [key: string]: unknown };
	}
	return null;
}

describe("CLOUD-09 a cloud terminal", () => {
	it("opens the terminal channel and sends its start message", async () => {
		const memory = cloudMemoryPlatform();
		try {
			const opened = await openCloudTerminal(memory.platform.cloud, HOST, {
				terminalId: "t1",
				cwd: "/workspace",
				cols: 100,
				rows: 30,
				command: { program: "/bin/bash", args: ["-l"] },
			});
			expect(opened.ok).toBe(true);
			const id = memory.controls.cloudRelayIds[0] as string;
			expect(memory.controls.cloudRelayChannels[id]).toBe("terminal");
			expect(sent(memory, "start")).toMatchObject({
				type: "start",
				cwd: "/workspace",
				cols: 100,
				rows: 30,
				command: ["/bin/bash", "-l"],
			});
			if (opened.ok) await opened.value.kill();
		} finally {
			memory.controls.dispose();
		}
	});

	it("carries output in, and input and resize out", async () => {
		const memory = cloudMemoryPlatform();
		try {
			const opened = await openCloudTerminal(memory.platform.cloud, HOST, {
				terminalId: "t1",
				cwd: "/workspace",
				cols: 80,
				rows: 24,
			});
			if (!opened.ok) throw new Error(opened.error.message);
			const handle = opened.value;
			const chunks: string[] = [];
			handle.onData((chunk) => chunks.push(new TextDecoder().decode(chunk)));
			const id = memory.controls.cloudRelayIds[0] as string;
			expect(memory.controls.emitCloudLine(id, JSON.stringify({ type: "ready" }))).toBe(true);
			expect(
				memory.controls.emitCloudLine(
					id,
					JSON.stringify({ type: "data", data: base64("hello\r\n") }),
				),
			).toBe(true);
			expect(chunks.join("")).toBe("hello\r\n");

			await handle.write("ls\r");
			expect(new TextDecoder().decode(base64ToBytes(sent(memory, "input")?.data as string))).toBe(
				"ls\r",
			);
			await handle.resize(120, 40);
			expect(sent(memory, "resize")).toMatchObject({ cols: 120, rows: 40 });
			await handle.kill();
		} finally {
			memory.controls.dispose();
		}
	});

	it("reports the exit code once", async () => {
		const memory = cloudMemoryPlatform();
		try {
			const opened = await openCloudTerminal(memory.platform.cloud, HOST, {
				terminalId: "t1",
				cwd: "/workspace",
				cols: 80,
				rows: 24,
			});
			if (!opened.ok) throw new Error(opened.error.message);
			const exits: (number | null)[] = [];
			opened.value.onExit((code) => exits.push(code));
			const id = memory.controls.cloudRelayIds[0] as string;
			memory.controls.emitCloudLine(id, JSON.stringify({ type: "exit", exitCode: 3 }));
			memory.controls.emitCloudClosed(id, "The Worker closed the relay.");
			expect(exits).toEqual([3]);
		} finally {
			memory.controls.dispose();
		}
	});

	it("ends with a lost connection when the stream drops without an exit", async () => {
		const memory = cloudMemoryPlatform();
		try {
			const opened = await openCloudTerminal(memory.platform.cloud, HOST, {
				terminalId: "t1",
				cwd: "/workspace",
				cols: 80,
				rows: 24,
			});
			if (!opened.ok) throw new Error(opened.error.message);
			const handle = opened.value;
			const exits: (number | null)[] = [];
			handle.onExit((code) => exits.push(code));
			const id = memory.controls.cloudRelayIds[0] as string;
			memory.controls.emitCloudClosed(id, "The network failed.");
			expect(exits).toEqual([null]);
			expect(await handle.screenText(10)).toContain("Connection lost.");
		} finally {
			memory.controls.dispose();
		}
	});

	it("keeps plain text of the last lines for the agent's output tool", async () => {
		const memory = cloudMemoryPlatform();
		try {
			const opened = await openCloudTerminal(memory.platform.cloud, HOST, {
				terminalId: "t1",
				cwd: "/workspace",
				cols: 80,
				rows: 24,
			});
			if (!opened.ok) throw new Error(opened.error.message);
			const handle = opened.value;
			const id = memory.controls.cloudRelayIds[0] as string;
			memory.controls.emitCloudLine(
				id,
				JSON.stringify({
					type: "data",
					data: base64("\u001b[31mred\u001b[0m\none\ntwo\n"),
				}),
			);
			expect(await handle.screenText(2)).toBe("one\ntwo");
			const snapshot = await handle.screenSnapshot();
			expect(snapshot.ok && snapshot.value.data).toContain("red");
		} finally {
			memory.controls.dispose();
		}
	});
});

function base64ToBytes(text: string): Uint8Array {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}
