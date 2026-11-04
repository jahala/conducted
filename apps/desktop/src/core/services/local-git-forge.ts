/**
 * @feature GIT-14 Local-git forge: pull request state for repositories without GitHub
 * Owns: making PR-like information for a repository that has no GitHub remote (commits ahead and
 * behind, and whether merging would conflict), the "Merge into target" request, and the list of
 * things each kind of forge can do.
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
 * ahead, because there is nothing to merge.
 * Test first: synthesizePrInfo for a branch 2 commits ahead whose merge probe exits 1 reports
 * ahead 2 and mergeState "DIRTY".
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import type { GitRunner } from "../git/runner.ts";
import type { WorkspaceGitContext } from "./git.ts";
import type { AgentMessenger } from "./sessions.ts";

/** What a forge can do. The header and the PR actions show only what is true here. */
export interface ForgeCapabilities {
	remoteRequests: boolean;
	createPullRequest: boolean;
	updatePullRequest: boolean;
	draftPullRequest: boolean;
	markReady: boolean;
	merge: boolean;
	autoMerge: boolean;
	reviewerRequests: boolean;
	reviewThreadResolution: boolean;
	checks: boolean;
	checkLogs: boolean;
	checkRetry: boolean;
	issuePicker: boolean;
	repoCreate: boolean;
}

export const GITHUB_FORGE_CAPABILITIES: ForgeCapabilities = {
	remoteRequests: true,
	createPullRequest: true,
	updatePullRequest: true,
	draftPullRequest: true,
	markReady: true,
	merge: true,
	autoMerge: true,
	reviewerRequests: true,
	reviewThreadResolution: true,
	checks: true,
	checkLogs: true,
	checkRetry: true,
	issuePicker: true,
	repoCreate: true,
};

export const LOCAL_GIT_FORGE_CAPABILITIES: ForgeCapabilities = {
	remoteRequests: false,
	createPullRequest: false,
	updatePullRequest: false,
	draftPullRequest: false,
	markReady: false,
	merge: false,
	autoMerge: false,
	reviewerRequests: false,
	reviewThreadResolution: false,
	checks: false,
	checkLogs: false,
	checkRetry: false,
	issuePicker: false,
	repoCreate: false,
};

/** The pull request information a local-git workspace shows in place of GitHub's. */
export interface LocalPrInfo {
	/** Commits on the branch that the target does not have. */
	ahead: number;
	/** Commits on the target that the branch does not have. */
	behind: number;
	/** "DIRTY" when merging would conflict. Null when nothing is ahead. */
	mergeState: "CLEAN" | "DIRTY" | null;
}

export interface LocalGitForgeDeps {
	git: GitRunner;
	agent: AgentMessenger;
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<WorkspaceGitContext>>;
	/** The setting `local_git_forge_enabled`, read when called. */
	enabled: () => boolean;
}

export class LocalGitForge {
	readonly #deps: LocalGitForgeDeps;

	constructor(deps: LocalGitForgeDeps) {
		this.#deps = deps;
	}

	/**
	 * Runs `revListLeftRightCount(target, branch)`, and when the branch is ahead,
	 * `mergeTreeWriteTree(target, branch)` in the workspace folder.
	 */
	synthesizePrInfo(_workspaceId: WorkspaceId): Promise<Result<LocalPrInfo>> {
		void this.#deps;
		return notImplemented("GIT-14");
	}

	/** Backs "Merge into target": sends the agent `mergeIntoTargetInstruction`. */
	mergeIntoTarget(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("GIT-14");
	}
}
