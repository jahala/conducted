/**
 * @feature COMP-05 # PR and issue mentions
 * Owns: the search behind the composer's '#' menu: the workspace project's GitHub pull requests
 * and issues and, when Linear is connected, the user's Linear issues, as one list with one notice
 * line; and writing the chosen item's context file. Also the one rule for which GitHub sign-in
 * states stop GitHub from listing, which the Link issue dialog (PR-09) reads too.
 * Behaviour: ui-map.md 3.5 ('#': pull requests and issues; selecting writes a PR context file),
 * services-map.md 5B.8.2 (GitHub's open issues), 5B.8.3 (`.context/pull-requests/<n>.md` and
 * `[GITHUB]-<n>.md`).
 * Must handle: a project with no GitHub remote, no `gh`, a signed-out or rejected `gh`, or no
 * network (a notice instead of GitHub rows, and Linear still asked); a source whose list fails
 * while another answers (its message joins the notice); every source failing (the first error);
 * more than `PR_MENTION_LIMIT` rows (cut to the limit); a pull request with no number (not written).
 * Our design choice: the notice texts are ours, apart from 'Run "gh auth login" to connect
 * GitHub.', which is Conductor's Link issue wording; the research gives the '#' menu none.
 * Test first: with `gh` missing, the search says to install it and still lists Linear issues.
 */
import { type AppError, appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import {
	type GitHubSetupNeeded,
	githubSetupNeeded,
	PR_MENTION_LIMIT,
	type PrMentionItem,
	type PrMentionSearchResult,
} from "../mention-search.ts";
import type { GithubService } from "./github.ts";
import { toGitHubAccessView } from "./github.ts";
import type { LinearService } from "./linear.ts";
import type { RepoService } from "./repo.ts";
import type { WorkspaceService } from "./workspace.ts";

const SETUP_NOTICE: Readonly<Record<GitHubSetupNeeded, string>> = {
	gh_missing: "Install GitHub CLI (gh) to list pull requests and issues.",
	signed_out: 'Run "gh auth login" to connect GitHub.',
	offline: "You're offline. Pull requests and issues can't be listed.",
};

export interface MentionSearchServices {
	workspace: Pick<WorkspaceService, "store">;
	repo: Pick<RepoService, "store">;
	github: Pick<
		GithubService,
		| "store"
		| "listPullRequests"
		| "listIssues"
		| "attachPullRequestToWorkspace"
		| "attachIssueToWorkspace"
	>;
	linear: Pick<LinearService, "store" | "loadMyIssues" | "search" | "attachToWorkspace">;
}

/** Searches the workspace's sources for the '#' menu. */
export async function searchPrMentions(
	services: MentionSearchServices,
	workspaceId: WorkspaceId,
	query: string,
): Promise<Result<PrMentionSearchResult>> {
	const row = services.workspace.store.getState().workspacesById[workspaceId];
	const repo = row === undefined ? undefined : services.repo.store.getState().reposById[row.repoId];
	const remoteUrl = repo?.remoteUrl ?? null;
	const setup = githubSetupNeeded(toGitHubAccessView(services.github.store.getState().access));
	const items: PrMentionItem[] = [];
	const notices: string[] = [];
	const errors: AppError[] = [];
	if (remoteUrl === null) {
		notices.push("This project has no GitHub remote.");
	} else if (setup !== null) {
		notices.push(SETUP_NOTICE[setup]);
	} else {
		const [pulls, issues] = await Promise.all([
			services.github.listPullRequests(remoteUrl, query),
			services.github.listIssues(remoteUrl, query),
		]);
		if (pulls.ok) {
			items.push(
				...pulls.value.map((pull) => ({
					kind: "pull_request" as const,
					provider: "github" as const,
					number: pull.number,
					identifier: `#${pull.number}`,
					title: pull.title,
					id: String(pull.number),
				})),
			);
		} else {
			errors.push(pulls.error);
		}
		if (issues.ok) {
			items.push(
				...issues.value.map((issue) => ({
					kind: "issue" as const,
					provider: "github" as const,
					number: Number(issue.id),
					identifier: issue.identifier,
					title: issue.title,
					url: issue.url,
					id: issue.id,
				})),
			);
		} else {
			errors.push(issues.error);
		}
	}
	if (services.linear.store.getState().connection === "connected") {
		const found =
			query.trim() === ""
				? await services.linear.loadMyIssues()
				: await services.linear.search(query);
		if (found.ok) {
			items.push(
				...found.value.map((issue) => ({
					kind: "issue" as const,
					provider: "linear" as const,
					number: null,
					identifier: issue.identifier,
					title: issue.title,
					url: issue.url,
					id: issue.id,
				})),
			);
		} else {
			errors.push(found.error);
		}
	}
	const firstError = errors[0];
	if (firstError !== undefined) {
		if (items.length === 0) return err(firstError);
		notices.push(firstError.message);
	}
	return ok({
		items: items.slice(0, PR_MENTION_LIMIT),
		notice: notices.length > 0 ? notices.join(" ") : undefined,
	});
}

/** Writes the chosen item's context file and returns its workspace-relative path. */
export function attachPrMention(
	services: MentionSearchServices,
	workspaceId: WorkspaceId,
	item: PrMentionItem,
): Promise<Result<string>> {
	if (item.kind === "pull_request") {
		if (item.number === null) {
			return Promise.resolve(
				err(appError("pr_mention_unknown", "That pull request has no number to write.")),
			);
		}
		return services.github.attachPullRequestToWorkspace(workspaceId, item.number);
	}
	if (item.provider === "linear") return services.linear.attachToWorkspace(workspaceId, item.id);
	return services.github.attachIssueToWorkspace(workspaceId, { provider: "github", id: item.id });
}
