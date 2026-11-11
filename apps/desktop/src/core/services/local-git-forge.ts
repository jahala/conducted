/**
 * @feature GIT-14 Local-git forge: pull request state for repositories without GitHub
 * Owns: making PR-like information for a repository that has no GitHub remote (commits ahead and
 * behind, and whether merging would conflict), the "Merge into target" request, and the things each
 * kind of forge can do that an action reads.
 * Behaviour: services-map.md 3.7.7 (synthesised PR info), 5B.1.5 (forge capabilities: all true for
 * GitHub, all false for local git), section 6 (the switch that turns the forge on).
 * Must handle: a branch with nothing ahead (no conflict check runs); a conflict probe that exits
 * with 1 or prints a conflict stage line means "dirty", any other failure is an error and never a
 * guess; a repository with no remote at all; git older than the one that knows
 * `merge-tree --write-tree` (an error that names the git version, not a wrong "clean"); the
 * switch is off (every method returns the error code `local_git_forge_off`); the branch or target
 * missing (an error Result).
 * Our design choice: "merge into target" is a request to the agent, like commit and push, because
 * the app never merges by itself (services/agent-instructions.ts). The switch is the setting
 * `local_git_forge_enabled` (registries/settings.ts). The mergeability is `null` when nothing is
 * ahead, because there is nothing to merge. `refresh` writes the newest answer for a workspace to
 * the service's store, so an older answer that arrives late changes nothing.
 * Test first: synthesizePrInfo for a branch 2 commits ahead whose merge probe exits 1 reports
 * ahead 2 and mergeState "DIRTY".
 */
import { type AppError, appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createLatestWins } from "../async/latest-wins.ts";
import { mergeTreeWriteTree, revListLeftRightCount } from "../git/commands.ts";
import type { GitRunner } from "../git/runner.ts";
import { parseLeftRightCount } from "../git/status.ts";
import type { ForgeCapabilities } from "../local-git-forge.ts";
import { mergeIntoTargetInstruction } from "./agent-instructions.ts";
import { targetBranchName, type WorkspaceGitContext } from "./git.ts";
import type { AgentMessenger } from "./sessions.ts";

/** The pull request information a local-git workspace shows in place of GitHub's. */
export interface LocalPrInfo {
	/** Commits on the branch that the target does not have. */
	ahead: number;
	/** Commits on the target that the branch does not have. */
	behind: number;
	/** "DIRTY" when merging would conflict. Null when nothing is ahead. */
	mergeState: "CLEAN" | "DIRTY" | null;
}

/** One workspace's newest synthesised pull request information, or why it could not be read. */
interface LocalPrInfoEntry {
	info: LocalPrInfo | null;
	error: AppError | null;
}

interface LocalGitForgeState {
	byWorkspace: Readonly<Record<string, LocalPrInfoEntry>>;
}

/** A merge-tree conflict line: `<mode> <oid> <1|2|3>\t<path>`. */
const MERGE_TREE_CONFLICT_LINE = /^[0-7]{6} [0-9a-f]+ [123]\t/m;

/** What git prints when it does not know `merge-tree --write-tree`. */
const MERGE_TREE_UNSUPPORTED =
	/unknown option.*write-tree|unrecognized (?:option|argument).*write-tree|unknown switch.*write-tree|is not a git command/i;

/** The error for a git too old to predict a merge. It names the version that can. */
const MERGE_TREE_UNSUPPORTED_MESSAGE =
	"Predicting merges needs git 2.38 or newer, because this git has no merge-tree --write-tree. Update git and try again.";

export interface LocalGitForgeDeps {
	git: GitRunner;
	agent: AgentMessenger;
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
	/** The setting `local_git_forge_enabled`, read when called. */
	enabled: () => boolean;
}

export class LocalGitForge {
	/** The newest synthesised information per workspace, for the Git panel header. */
	readonly store: StoreApi<LocalGitForgeState>;
	readonly #deps: LocalGitForgeDeps;
	readonly #latest = createLatestWins<string>();

	constructor(deps: LocalGitForgeDeps) {
		this.#deps = deps;
		this.store = createStore<LocalGitForgeState>(() => ({ byWorkspace: {} }));
	}

	/**
	 * Reads the target and branch, counts them with `revListLeftRightCount`, and when the branch
	 * is ahead, predicts a conflict with `mergeTreeWriteTree` in the workspace folder. Only a
	 * probe exit of 1, or a conflict stage line in its output, means "DIRTY"; every other
	 * failure is an error.
	 */
	async synthesizePrInfo(workspaceId: WorkspaceId): Promise<Result<LocalPrInfo>> {
		if (!this.#deps.enabled()) {
			return err(appError("local_git_forge_off", "The local-git forge is turned off."));
		}
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return context;
		const target = targetBranchName(context.value.targetBranch, context.value.remote).trim();
		if (target.length === 0) {
			return err(appError("local_git_forge_no_target", "This workspace has no target branch."));
		}
		const branch = context.value.branch.trim();
		if (branch.length === 0) {
			return err(appError("local_git_forge_no_branch", "This workspace has no branch."));
		}

		const cwd = context.value.workspacePath;
		const counts = await this.#deps.git.stdout(revListLeftRightCount(target, branch), { cwd });
		if (!counts.ok) return counts;
		const parsed = parseLeftRightCount(counts.value);
		if (!parsed.ok) return parsed;
		const behind = parsed.value.left;
		const ahead = parsed.value.right;
		if (ahead === 0) return ok({ ahead, behind, mergeState: null });

		const probe = await this.#deps.git.run(mergeTreeWriteTree(target, branch), { cwd });
		if (!probe.ok) return probe;
		const output = probe.value;
		if (output.exitCode !== 0 && output.exitCode !== 1) {
			const text = `${output.stderr}\n${output.stdout}`.trim();
			if (MERGE_TREE_UNSUPPORTED.test(text)) {
				return err(appError("local_git_forge_git_too_old", MERGE_TREE_UNSUPPORTED_MESSAGE));
			}
			return err(
				appError(
					"git_failed",
					text.length > 0 ? text : `git merge-tree exited with code ${output.exitCode}.`,
				),
			);
		}
		const dirty = output.exitCode === 1 || MERGE_TREE_CONFLICT_LINE.test(output.stdout);
		return ok({ ahead, behind, mergeState: dirty ? "DIRTY" : "CLEAN" });
	}

	/** Reads the information and writes only the newest answer for the workspace to the store. */
	async refresh(workspaceId: WorkspaceId): Promise<Result<LocalPrInfo>> {
		const key = String(workspaceId);
		const ticket = this.#latest.begin(key);
		const result = await this.synthesizePrInfo(workspaceId);
		const latest = this.#latest.isLatest(ticket);
		this.#latest.settle(ticket);
		if (latest) {
			this.store.setState((state) => ({
				byWorkspace: {
					...state.byWorkspace,
					[key]: {
						info: result.ok ? result.value : null,
						error: result.ok ? null : result.error,
					},
				},
			}));
		}
		return result;
	}

	/** Backs "Merge into target": sends the agent `mergeIntoTargetInstruction`. */
	async mergeIntoTarget(workspaceId: WorkspaceId): Promise<Result<void>> {
		if (!this.#deps.enabled()) {
			return err(appError("local_git_forge_off", "The local-git forge is turned off."));
		}
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return context;
		const target = targetBranchName(context.value.targetBranch, context.value.remote).trim();
		if (target.length === 0) {
			return err(appError("local_git_forge_no_target", "This workspace has no target branch."));
		}
		const branch = context.value.branch.trim();
		if (branch.length === 0) {
			return err(appError("local_git_forge_no_branch", "This workspace has no branch."));
		}
		const text = mergeIntoTargetInstruction({
			remote: context.value.remote,
			targetBranch: target,
			branch,
			customPrompt: null,
		});
		const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
		return sent.ok ? ok(undefined) : err(sent.error);
	}
}
