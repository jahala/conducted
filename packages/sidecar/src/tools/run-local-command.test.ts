import { describe, expect, test } from "bun:test";
import { localCommandTimeoutMs } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import type { AppToolBackend } from "./backend.ts";
import { runLocalCommandTool } from "./run-local-command.ts";
import type { LocalCommandAnswer } from "./types.ts";

const sessionId = "s1" as SessionId;

function context(answer: LocalCommandAnswer) {
	const calls: { command: string; timeoutMs: number; cwd?: string }[] = [];
	const backend = {
		async runLocalCommand(
			_sessionId: SessionId,
			options: { command: string; timeoutMs: number; cwd?: string },
		) {
			calls.push(options);
			return ok(answer);
		},
	} as unknown as AppToolBackend;
	return { context: { sessionId, backend }, calls };
}

describe("CLOUD-14 the RunLocalCommand tool", () => {
	test("execute() without a timeout asks the app for the 60 second default", async () => {
		const h = context({ code: 0, stdout: "", stderr: "" });
		await runLocalCommandTool.execute({ command: "ls" }, h.context);
		expect(h.calls[0]?.timeoutMs).toBe(60_000);
	});

	test("a timeout is clamped to two minutes, or thirty with an extended reason", () => {
		expect(localCommandTimeoutMs({ timeoutMs: 999_999 })).toBe(120_000);
		expect(
			localCommandTimeoutMs({ timeoutMs: 9_999_999, extendedTimeoutReason: "a long build" }),
		).toBe(1_800_000);
		expect(localCommandTimeoutMs({ timeoutMs: 5_000 })).toBe(5_000);
	});

	test("a denied command is an error result with the app's message", async () => {
		const h = context({ denied: true, error: "The user denied local command execution." });
		const result = await runLocalCommandTool.execute({ command: "ls" }, h.context);
		expect(result.isError).toBe(true);
		expect(result.text).toBe("The user denied local command execution.");
	});

	test("a command that took too long is an error result", async () => {
		const h = context({ timedOut: true, error: "The command timed out after 60000 ms." });
		const result = await runLocalCommandTool.execute({ command: "sleep 99" }, h.context);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("timed out");
	});

	test("the result carries the exit code, the output and where long output was saved", async () => {
		const h = context({
			code: 2,
			stdout: "the output",
			stderr: "a warning",
			outputPath: "/workspace/.context/conductor/run-local-command-output-1.txt",
		});
		const result = await runLocalCommandTool.execute({ command: "make" }, h.context);
		expect(result.isError).toBe(false);
		expect(result.text).toContain("the output");
		expect(result.text).toContain("a warning");
		expect(result.text).toContain("Exit code: 2.");
		expect(result.text).toContain("run-local-command-output-1.txt");
	});
});
