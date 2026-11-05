import { describe, expect, test } from "bun:test";
import { createLogger } from "../logging/logger.ts";
import { startChild } from "./spawn-child.ts";

const logger = createLogger({
	sink: () => {},
	clock: { now: () => 0 },
	level: "debug",
	scope: "test",
});

function start(script: string) {
	const started = startChild({
		command: "sh",
		args: ["-c", script],
		cwd: process.cwd(),
		env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
		logger,
	});
	if (!started.ok) throw new Error(started.error.message);
	return started.value;
}

describe("SIDE-01 long-lived child processes", () => {
	test("SIDE-01 a child that ignores SIGTERM is killed and stop resolves with the signal", async () => {
		const child = start('trap "" TERM; echo ready; while :; do sleep 0.05; done');
		const exits: (string | null)[] = [];
		child.onExit((_code, signal) => exits.push(signal));
		await readLine(child.stdout);

		await child.stop(50, 100);

		expect(exits).toEqual(["SIGKILL"]);
	});

	test("SIDE-01 stderr reaches the listener while the child is still running", async () => {
		const child = start("echo early >&2; sleep 30");
		const seen: string[] = [];
		let arrived: () => void = () => {};
		const first = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		child.onStderr((text) => {
			seen.push(text);
			arrived();
		});

		await first;
		expect(seen.join("")).toContain("early");

		await child.stop(10, 100);
	});

	test("SIDE-01 stopping a child that already exited does not throw", async () => {
		const child = start("exit 0");
		await new Promise<void>((resolve) => child.onExit(() => resolve()));

		await child.stop(10, 100);
	});
});

async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = "";
	while (!text.includes("\n")) {
		const { done, value } = await reader.read();
		if (done) break;
		text += decoder.decode(value, { stream: true });
	}
	reader.releaseLock();
	return text;
}
