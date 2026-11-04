/**
 * @feature PR-01 GitHub service: access, PR polling and pull request actions
 * Owns: checking that `gh` is usable, polling pull request state for the workspaces on screen,
 * and the write actions (merge, auto-merge, ready, approve, edit, re-run checks).
 * Behaviour: services-map.md 3.9 (auth probes, health), 3.7 (create, read, write), 3.7.3 and
 * 5B.1.2 to 5B.1.5 (cadence, gate, fields, state), 3.8 (stacks, Graphite), 5B.1.7 (write
 * actions and their dedupe), 5B.1.9 (archive on merge), ui-map.md 3.6.
 * Must handle: `gh` missing or signed out (state tells the UI which, with the command to run);
 * only the "unauthorized" kind of failure marks access broken; no request when the branch was
 * never pushed and no PR number is bound; "no PR found" is remembered for 5 minutes; a closed,
 * unmerged PR is shown only while the local branch still matches its head; the same action
 * twice at once (merge, approve, ready) runs once; a merge is pinned to the local HEAD and
 * refused with a clear message when HEAD cannot be read; the merge method follows the repo's
 * allowed methods (squash, then rebase, then merge); an UNKNOWN mergeability never replaces a
 * known one for the same head commit; polling pauses when the window is not focused for the
 * sidebar workspaces; the batch and rate-limit rules come from pr-polling.ts; "archive on merge"
 * fires only on the transition to merged, and keeps the workspace while other PRs of its stack
 * are open.
 * Our design choice: access is the user's own `gh auth login`. No tokens are stored. Graphite
 * support is read-only and off unless the setting is on. Creating a PR, committing and fixing
 * checks are requests to the agent (see agent-instructions.ts).
 * Test first: two merge calls at once send one `gh pr merge`.
 */
import { notImplemented, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Unsubscribe } from "../../platform/platform.ts";
import type { GitRunner } from "../git/runner.ts";
import type { PullRequest } from "../model.ts";
import type { PollRole } from "./pr-polling.ts";
import type { AgentMessenger } from "./sessions.ts";

export type GithubAccess =
	| { status: "unknown" }
	| { status: "ok"; login: string }
	| { status: "gh_missing" }
	| { status: "signed_out" }
	| { status: "unauthorized" }
	| { status: "offline" };

export interface WorkspacePrEntry {
	pullRequest: PullRequest | null;
	/** Why there is no PR to show, when there is not. */
	unavailable: "none" | "offline" | "no_github_access" | "not_github" | "loading" | "no_pr";
	fetchedAt: number | null;
}

export interface GithubState {
	access: GithubAccess;
	byWorkspace: Readonly<Record<string, WorkspacePrEntry>>;
}

export interface PrWorkspaceContext {
	workspaceId: WorkspaceId;
	workspacePath: string;
	branch: string;
	/** Name of the remote, for example "origin". */
	remote: string;
	prNumber: number | null;
}

export interface GithubServiceDeps {
	git: GitRunner;
	agent: AgentMessenger;
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<PrWorkspaceContext>>;
	/** Called when a PR becomes merged, so the workspace service can archive on merge. */
	onMerged: (workspaceId: WorkspaceId, prNumber: number) => void;
	now: () => number;
}

export class GithubService {
	readonly store: StoreApi<GithubState>;
	readonly #deps: GithubServiceDeps;

	constructor(deps: GithubServiceDeps) {
		this.#deps = deps;
		this.store = createStore<GithubState>(() => ({
			access: { status: "unknown" },
			byWorkspace: {},
		}));
	}

	/** Runs `gh auth status` and `gh api user`; updates `access`. */
	checkAccess(): Promise<Result<GithubAccess>> {
		void this.#deps;
		return notImplemented("PR-01");
	}

	/** Starts polling one workspace until the returned function is called. */
	/** Backs `Actions.app.recheckGitHubAccess`: runs the access probes again and updates the store. */
	recheckAccess(): Promise<Result<void>> {
		return notImplemented("PR-01");
	}

	watch(_workspaceId: WorkspaceId, _role: PollRole): Unsubscribe {
		return notImplemented("PR-03");
	}

	pollNow(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-03");
	}

	/** Backs `Actions.pullRequests.create`: asks the agent to open the PR. */
	create(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-02");
	}

	/** Opens GitHub's new-PR page in the browser. */
	openOnGithub(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-02");
	}

	/** Backs `Actions.pullRequests.fixErrors`: sends failing checks and log tails to the agent. */
	fixErrors(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-05");
	}

	rerunFailedChecks(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-05");
	}

	markReady(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	merge(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	setAutoMerge(_workspaceId: WorkspaceId, _enabled: boolean): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	approve(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	updateTitleAndBody(
		_workspaceId: WorkspaceId,
		_title: string,
		_body: string,
	): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	/** Runs `gh stack sync` for a stacked branch. */
	syncStack(_workspaceId: WorkspaceId): Promise<Result<void>> {
		return notImplemented("PR-08");
	}
}
