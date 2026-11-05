// @vitest-environment node
/**
 * @feature RUN-02 Spotlight: test workspace changes in the repo root, restore on stop
 * Tests healing a repository root after a crash: nothing happens without a leftover
 * `pre-spotlight` ref, a leftover ref is restored and then deleted, a failed restore keeps the ref,
 * and app start reaches the heal through the real container.
 */
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedRepo } from "../../test/container.ts";
import { FakeGitRunner, gitOutput, gitUnscripted } from "../../test/fake-git-runner.ts";
import { checkpointRef, PRE_SPOTLIGHT_CHECKPOINT_ID } from "../git/refs.ts";
import { SpotlightService } from "./spotlight.ts";

const ROOT = "/code/project";
const CHECKPOINTER = "/app/bin/checkpointer.sh";
const REF = checkpointRef(PRE_SPOTLIGHT_CHECKPOINT_ID);

afterEach(() => {
	vi.restoreAllMocks();
});

/** A git fake over one set of refs, whose checkpointer restore exits with `restoreExit`. */
function refGit(refs: Set<string>, restoreExit = 0): FakeGitRunner {
	return new FakeGitRunner((command) => {
		if (command.program === CHECKPOINTER && command.args[0] === "restore") {
			return gitOutput("", restoreExit === 0 ? "" : "restore failed", restoreExit);
		}
		if (command.args[0] === "show-ref") {
			return gitOutput("", "", refs.has(command.args.at(-1) ?? "") ? 0 : 1);
		}
		if (command.args[0] === "update-ref" && command.args[1] === "-d") {
			refs.delete(command.args.at(-1) ?? "");
			return gitOutput();
		}
		return gitUnscripted(command);
	});
}

const service = (git: FakeGitRunner): SpotlightService =>
	new SpotlightService({
		git,
		terminals: { runScript: vi.fn(), stop: vi.fn() } as never,
		checkpointerPath: CHECKPOINTER,
		spotlighterPath: "/app/bin/spotlighter.sh",
	});

describe("RUN-02 healing a repository root after a crash", () => {
	it("changes nothing when no pre-spotlight checkpoint is left", async () => {
		const git = refGit(new Set());

		await expect(service(git).healAfterCrash(ROOT)).resolves.toEqual(ok(false));
		expect(git.commands.map((command) => command.args[0])).toEqual(["show-ref"]);
		expect(git.calls[0]?.options.cwd).toBe(ROOT);
	});

	it("restores a leftover checkpoint in the root, then deletes its ref", async () => {
		const refs = new Set([REF]);
		const git = refGit(refs);

		await expect(service(git).healAfterCrash(ROOT)).resolves.toEqual(ok(true));
		expect(git.commands.map((command) => [command.program, ...command.args])).toEqual([
			["git", "show-ref", "--verify", "--quiet", REF],
			[CHECKPOINTER, "restore", PRE_SPOTLIGHT_CHECKPOINT_ID],
			["git", "update-ref", "-d", REF],
		]);
		expect(git.calls.every((call) => call.options.cwd === ROOT)).toBe(true);
		expect(git.worktreeLocks).toEqual([ROOT]);
		expect(refs.size).toBe(0);
	});

	it("keeps the checkpoint when the restore fails, so the next start tries again", async () => {
		const refs = new Set([REF]);
		const git = refGit(refs, 1);

		const healed = await service(git).healAfterCrash(ROOT);

		expect(healed.ok).toBe(false);
		if (healed.ok) return;
		expect(healed.error.code).toBe("spotlight_restore_failed");
		expect(healed.error.message).toContain("the next start tries again");
		expect(refs.has(REF)).toBe(true);
		expect(git.commands.some((command) => command.args[0] === "update-ref")).toBe(false);
	});
});

describe("RUN-02 heal at app start through the real container", () => {
	it("starts with a project and reports a heal that could not run as a start warning", async () => {
		const test = createTestContainer();
		try {
			await seedRepo(test.container, { rootPath: ROOT });
			const { services } = test.container;
			for (const started of [
				services.repo,
				services.workspace,
				services.sections,
				services.favoriteModels,
				services.terminals,
				services.system,
			]) {
				vi.spyOn(started, "start").mockResolvedValue(ok(undefined) as never);
			}
			vi.spyOn(services.github, "checkAccess").mockResolvedValue(ok({ status: "unknown" }));
			vi.spyOn(services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
			// No git answer is scripted, so the heal's ref check cannot run.

			const started = await test.container.start();

			expect(started.ok).toBe(true);
			if (!started.ok) return;
			const showRef = test.memory.controls.shellCalls.find(
				(command) => command.program === "git" && command.args.includes("show-ref"),
			);
			expect(showRef?.cwd).toBe(ROOT);
			expect(started.value.warnings.some((warning) => warning.step === "spotlight")).toBe(true);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
