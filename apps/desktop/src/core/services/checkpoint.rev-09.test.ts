/**
 * @feature REV-09 Turn changes from checkpoints
 * Tests the checkpoint reads behind the per-turn diff: ref existence, the waiting rule, the file
 * list from the checkpointer's diff, the NUL-separated count, and the 5 MB turn changes cache.
 */
import { ok, type SessionId, type TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { ShellOutput } from "../../platform/platform.ts";
import { FakeGitRunner } from "../../test/fake-git-runner.ts";
import type { GitCommand } from "../git/commands.ts";
import { turnCheckpointId } from "../git/refs.ts";
import type { GitRunner } from "../git/runner.ts";
import {
	CheckpointService,
	type CheckpointServiceDeps,
	TURN_CHANGES_CACHE_BYTES,
} from "./checkpoint.ts";

const SCRIPT = "/bin/checkpointer.sh";
const session = "s1" as SessionId;
const turn = "t1" as TurnId;

const output = (stdout = "", stderr = "", exitCode = 0): ShellOutput => ({
	stdout,
	stderr,
	exitCode,
});

function fakeGit(reply: (command: GitCommand) => ShellOutput | null): {
	git: GitRunner;
	commands: GitCommand[];
} {
	const git = new FakeGitRunner((command) => ok(reply(command) ?? output()));
	return { git, commands: git.commands };
}

const makeService = (
	git: GitRunner,
	sleep: CheckpointServiceDeps["sleep"] = async () => {},
): CheckpointService =>
	new CheckpointService({
		git,
		checkpointerPath: SCRIPT,
		workspacePathOf: async () => ok("/repo/worktree"),
		events: { markRevertedFromTurn: async () => ok(0) },
		markViewReverted: () => {},
		setting: <T>() => false as T,
		now: () => 0,
		sleep,
	});

const refExit = (command: GitCommand): number | null =>
	command.args[0] === "show-ref" ? Number(command.args.at(-1)?.endsWith("-start")) : null;

const diffReply = (changes: {
	nameStatus: string;
	numstat: string;
}): ((command: GitCommand) => ShellOutput | null) => {
	return (command) => {
		if (command.program !== SCRIPT) return null;
		if (command.args.includes("--name-status")) return output(changes.nameStatus);
		if (command.args.includes("--numstat")) return output(changes.numstat);
		return null;
	};
};

describe("REV-09 checkpoint service", () => {
	it("reads whether a checkpoint ref exists", async () => {
		const present = fakeGit((command) =>
			command.args[0] === "show-ref" ? output("", "", 0) : null,
		);
		await expect(makeService(present.git).exists(session, "checkpoint-1")).resolves.toEqual({
			ok: true,
			value: true,
		});

		const missing = fakeGit((command) =>
			command.args[0] === "show-ref" ? output("", "", 1) : null,
		);
		await expect(makeService(missing.git).exists(session, "checkpoint-1")).resolves.toEqual({
			ok: true,
			value: false,
		});

		const broken = fakeGit((command) =>
			command.args[0] === "show-ref" ? output("", "not a git repository", 128) : null,
		);
		const result = await makeService(broken.git).exists(session, "checkpoint-1");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("git_failed");
	});

	it("lists a turn's files from the start and end checkpoints", async () => {
		const { git, commands } = fakeGit((command) => {
			const exit = refExit(command);
			if (exit !== null) return output("", "", 0);
			return diffReply({
				nameStatus: "M\tsrc/a.ts\nA\tnew.ts\n",
				numstat: "3\t1\tsrc/a.ts\n2\t0\tnew.ts\n",
			})(command);
		});

		const result = await makeService(git).changesForTurn(session, turn);
		expect(result).toEqual({
			ok: true,
			value: [
				{
					path: "src/a.ts",
					status: "modified",
					linesAdded: 3,
					linesRemoved: 1,
					binary: false,
				},
				{ path: "new.ts", status: "added", linesAdded: 2, linesRemoved: 0, binary: false },
			],
		});

		const diffs = commands.filter((command) => command.program === SCRIPT);
		expect(diffs).toHaveLength(2);
		for (const command of diffs) {
			expect(command.args.slice(0, 3)).toEqual([
				"diff",
				"session-s1-turn-t1-start",
				"session-s1-turn-t1-end",
			]);
		}
		expect(diffs.map((command) => command.args.at(-1))).toEqual(
			expect.arrayContaining(["--name-status", "--numstat"]),
		);
	});

	it("waits while the checkpoint refs are not ready", async () => {
		let startChecks = 0;
		const { git } = fakeGit((command) => {
			const exit = refExit(command);
			if (exit === null) {
				return diffReply({ nameStatus: "M\ta.ts\n", numstat: "1\t0\ta.ts\n" })(command);
			}
			if (command.args.at(-1)?.endsWith("-start") !== true) return output("", "", 0);
			startChecks += 1;
			return output("", "", startChecks < 2 ? 1 : 0);
		});
		let waits = 0;
		const service = makeService(git, async () => {
			waits += 1;
		});

		await expect(service.changesForTurn(session, turn)).resolves.toEqual({
			ok: true,
			value: [{ path: "a.ts", status: "modified", linesAdded: 1, linesRemoved: 0, binary: false }],
		});
		expect(waits).toBeGreaterThan(0);
	});

	it("says the refs are not ready after the wait runs out", async () => {
		const { git } = fakeGit((command) =>
			command.args[0] === "show-ref" ? output("", "", 1) : null,
		);
		let waits = 0;
		const service = makeService(git, async () => {
			waits += 1;
		});

		const result = await service.changesForTurn(session, turn);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("checkpoint_not_ready");
		expect(waits).toBeGreaterThan(0);
	});

	it("counts files changed since a turn's start checkpoint with NUL separators", async () => {
		const { git, commands } = fakeGit((command) =>
			command.program === SCRIPT ? output("src/a.ts\0dir/with\nnewline.ts\0") : output("", "", 0),
		);

		await expect(makeService(git).changedSinceTurn(session, turn)).resolves.toEqual({
			ok: true,
			value: 2,
		});
		const diff = commands.find((command) => command.program === SCRIPT);
		expect(diff?.args).toEqual([
			"diff",
			turnCheckpointId(session, turn, "start"),
			"current",
			"--",
			"--name-only",
			"-z",
		]);
	});

	it("gives each caller its own copy so a change never reaches the cache", async () => {
		const { git, commands } = fakeGit((command) => {
			const exit = refExit(command);
			if (exit !== null) return output("", "", 0);
			return diffReply({ nameStatus: "M\tsrc/a.ts\n", numstat: "1\t0\tsrc/a.ts\n" })(command);
		});
		const service = makeService(git);
		const first = await service.changesForTurn(session, turn);
		expect(first.ok).toBe(true);
		if (!first.ok) return;

		const only = first.value[0];
		if (only !== undefined) only.path = "mutated.ts";
		first.value.push({
			path: "extra.ts",
			status: "added",
			linesAdded: 1,
			linesRemoved: 0,
			binary: false,
		});

		await expect(service.changesForTurn(session, turn)).resolves.toEqual({
			ok: true,
			value: [
				{ path: "src/a.ts", status: "modified", linesAdded: 1, linesRemoved: 0, binary: false },
			],
		});
		expect(
			commands.filter(
				(command) => command.program === SCRIPT && command.args.includes("--name-status"),
			),
		).toHaveLength(1);
	});

	it("reuses a turn's change list and evicts the oldest turn beyond 5 MB", async () => {
		const { git, commands } = fakeGit((command) => {
			const exit = refExit(command);
			if (exit !== null) return output("", "", 0);
			if (command.program !== SCRIPT) return null;
			const from = command.args[1] ?? "unknown";
			const path = `${from}-${"x".repeat(1_100_000)}.ts`;
			return command.args.includes("--name-status")
				? output(`M\t${path}\n`)
				: output(`1\t1\t${path}\n`);
		});
		const service = makeService(git);
		const diffCount = (): number =>
			commands.filter(
				(command) => command.program === SCRIPT && command.args.includes("--name-status"),
			).length;

		await service.changesForTurn(session, "t1" as TurnId);
		await service.changesForTurn(session, "t1" as TurnId);
		expect(diffCount()).toBe(1);

		for (const id of ["t2", "t3", "t4", "t5", "t6"]) {
			await service.changesForTurn(session, id as TurnId);
		}
		const afterEviction = diffCount();
		await service.changesForTurn(session, "t1" as TurnId);
		expect(diffCount()).toBe(afterEviction + 1);
		expect(TURN_CHANGES_CACHE_BYTES).toBe(5 * 1024 * 1024);
	});
});
