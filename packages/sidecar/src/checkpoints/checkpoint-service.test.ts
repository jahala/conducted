import { describe, expect, test } from "bun:test";
import type { CheckpointId, SessionId, TurnId } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import {
	CHECKPOINT_KILL_GRACE_MS,
	CHECKPOINT_TIMEOUT_MS,
	type CheckpointRequest,
	type RunCheckpointer,
	ScriptCheckpointService,
} from "./checkpoint-service.ts";

const sid = (value: string) => value as SessionId;
const tid = (value: string) => value as TurnId;
const cid = (value: string) => value as CheckpointId;

interface Call {
	args: readonly string[];
	options: { cwd: string; timeoutMs: number; killGraceMs: number };
}

type Reply =
	| { exitCode: number; stdout: string; stderr?: string }
	| Error
	| Promise<{ exitCode: number; stdout: string; stderr?: string }>;

function request(overrides: Partial<CheckpointRequest> = {}): CheckpointRequest {
	return {
		sessionId: sid("s1"),
		turnId: tid("t1"),
		workspacePath: "/work/alpha",
		...overrides,
	};
}

function harness(handle: (call: Call, index: number) => Reply) {
	const calls: Call[] = [];
	const records: LogRecord[] = [];
	const run: RunCheckpointer = async (args, options) => {
		const call = { args, options };
		calls.push(call);
		const reply = await handle(call, calls.length - 1);
		if (reply instanceof Error) throw reply;
		return reply;
	};
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 1_000 },
		level: "debug",
		scope: "test",
	});
	const service = new ScriptCheckpointService({
		scriptPath: "/app/bin/checkpointer.sh",
		run,
		logger,
	});
	return { calls, records, service };
}

const ok = (stdout = "") => ({ exitCode: 0, stdout });

describe("SIDE-08 checkpoint service", () => {
	test("exit code 101 gives a skipped merge-in-progress outcome and no checkpoint id", async () => {
		const { service, calls } = harness(() => ({ exitCode: 101, stdout: "" }));
		const outcome = await service.start(request());

		expect(outcome).toEqual({ skippedReason: "merge_in_progress" });
		expect(outcome.checkpointId).toBeUndefined();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.args).toEqual(["save", "--id", "session-s1-turn-t1-start", "--force"]);
		expect(calls[0]?.options).toEqual({
			cwd: "/work/alpha",
			timeoutMs: CHECKPOINT_TIMEOUT_MS,
			killGraceMs: CHECKPOINT_KILL_GRACE_MS,
		});
	});

	test("a created start checkpoint carries the id built from session, turn and phase", async () => {
		const { service } = harness(() => ok("session-s1-turn-t1-start\n"));
		expect(await service.start(request())).toEqual({
			checkpointId: cid("session-s1-turn-t1-start"),
		});
	});

	test("an end checkpoint uses the end phase in its id", async () => {
		const { service, calls } = harness(() => ok());
		await service.start(request());
		const outcome = await service.end(request());

		expect(outcome.checkpointId).toBe(cid("session-s1-turn-t1-end"));
		expect(calls[1]?.args).toEqual(["save", "--id", "session-s1-turn-t1-end", "--force"]);
	});

	test("an id that a git ref cannot hold is refused without running the script", async () => {
		const { service, calls } = harness(() => ok());
		const outcome = await service.start(request({ turnId: tid("t/../x") }));

		expect(outcome).toEqual({ skippedReason: "failed" });
		expect(calls).toHaveLength(0);
	});

	test("a runner that cannot start the script resolves to failed and logs once", async () => {
		const { service, records } = harness(() => new Error("spawn checkpointer.sh ENOENT"));

		expect(await service.start(request({ turnId: tid("t1") }))).toEqual({
			skippedReason: "failed",
		});
		expect(await service.start(request({ turnId: tid("t2") }))).toEqual({
			skippedReason: "failed",
		});

		const warnings = records.filter((record) => record.level === "warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.message).toContain("could not be started");
	});

	test("the end checkpoint waits for the start checkpoint of the same turn", async () => {
		let releaseStart: () => void = () => {};
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const { service, calls } = harness(async (call) => {
			if (call.args[0] === "save" && call.args[2]?.endsWith("-start")) await startGate;
			return ok();
		});

		const starting = service.start(request());
		const ending = service.end(request());
		expect(calls).toHaveLength(1);

		releaseStart();
		await starting;
		await ending;
		expect(calls.map((call) => call.args[0])).toEqual(["save", "save", "diff", "diff"]);
	});

	test("the end checkpoint lists name-status and numstat changes", async () => {
		const { service, calls } = harness((call) => {
			if (call.args[0] !== "diff") return ok();
			return call.args.includes("--name-status")
				? ok("R090\0old.ts\0new.ts\0M\0a.ts\0")
				: ok("3\t1\t\0old.ts\0new.ts\0" + "5\t0\ta.ts\0");
		});

		await service.start(request());
		const outcome = await service.end(request());

		expect(outcome).toEqual({
			checkpointId: cid("session-s1-turn-t1-end"),
			changes: [
				{
					path: "new.ts",
					oldPath: "old.ts",
					status: "renamed",
					linesAdded: 3,
					linesRemoved: 1,
					binary: false,
				},
				{ path: "a.ts", status: "modified", linesAdded: 5, linesRemoved: 0, binary: false },
			],
		});
		expect(calls[2]?.args).toEqual([
			"diff",
			"session-s1-turn-t1-start",
			"session-s1-turn-t1-end",
			"--",
			"--name-status",
			"-z",
		]);
		expect(calls[3]?.args).toEqual([
			"diff",
			"session-s1-turn-t1-start",
			"session-s1-turn-t1-end",
			"--",
			"--numstat",
			"-z",
		]);
	});

	test("a failing diff leaves the changes out and keeps the end checkpoint id", async () => {
		const { service } = harness((call) =>
			call.args[0] === "diff" ? { exitCode: 1, stdout: "" } : ok(),
		);

		await service.start(request());
		const outcome = await service.end(request());

		expect(outcome).toEqual({ checkpointId: cid("session-s1-turn-t1-end") });
	});

	test("an end checkpoint is still taken when the start was skipped, without a diff", async () => {
		const { service, calls } = harness((call) =>
			call.args[0] === "save" && call.args[2]?.endsWith("-start")
				? { exitCode: 102, stdout: "" }
				: ok(),
		);

		expect(await service.start(request())).toEqual({ skippedReason: "conflicts" });
		expect(await service.end(request())).toEqual({
			checkpointId: cid("session-s1-turn-t1-end"),
		});
		expect(calls.map((call) => call.args[0])).toEqual(["save", "save"]);
	});

	test("a skipped end checkpoints its reason and no id", async () => {
		const { service } = harness((call) =>
			call.args[0] === "save" && call.args[2]?.endsWith("-end")
				? { exitCode: 101, stdout: "" }
				: ok(),
		);

		await service.start(request());
		expect(await service.end(request())).toEqual({ skippedReason: "merge_in_progress" });
	});

	test("a repeated start for the same turn runs the script once", async () => {
		const { service, calls } = harness(() => ok());
		await Promise.all([service.start(request()), service.start(request())]);

		expect(calls).toHaveLength(1);
	});

	test("the log line keeps at most 64 KiB of output and error", async () => {
		const long = "x".repeat(80 * 1024);
		const { service, records } = harness(() => ({
			exitCode: 1,
			stdout: long,
			stderr: long,
		}));

		await service.start(request());

		const warning = records.find((record) => record.level === "warn");
		expect(String(warning?.data?.output).length).toBe(64 * 1024);
		expect(String(warning?.data?.error).length).toBe(64 * 1024);
	});
});
