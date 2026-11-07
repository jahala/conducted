/**
 * @feature PR-01 GitHub access, health, merge and the personal access token
 * @feature PR-03 the pull request poller: per-workspace timers, repo batches, skip rules and the
 * rate-limit gate's live caller
 * @feature PR-05 sending failing checks and their log tails to the agent
 * @feature PR-11 REST reads for issues and pull requests, and the context files they write
 * @feature PRJ-02 the owners and repositories the clone picker lists
 * @feature PRJ-03 the repository-name check the Create project dialog shows
 * @feature GIT-08 moving an open pull request's base when the target branch changes
 * @feature PR-04 the Checks tab's calls: one job's log (an expired log has its own error) and
 * re-running the failed workflow runs, one `gh run rerun --failed` per run
 * @feature PR-08 GitHub stacks: reading a pull request's stack, running the stack sync and
 * merging the stack
 * @feature REV-04 GitHub review comment sync: reading review threads and general comments, and
 * resolving a review thread
 * @feature PR-12 the guarded automatic catch-up of a stack branch after GitHub rewrites it
 * @feature PR-10 linking an existing pull request by its URL or number
 * Owns: probing `gh` access (`gh auth status`, the user's login, the git protocol), the access
 * health store, reading and writing the personal access token, every pull request write action
 * (merge, auto-merge on and off, mark ready, edit title and body, request and remove reviewers,
 * approve), the Fix errors instruction that sends failing checks to the agent, PR-03's polling of
 * watched pull requests, PR-11's REST reads, PRJ-02's clone pickers, PRJ-03's repository-name check,
 * GIT-08's base move, PR-08's stack read, stack sync and stack merge, REV-04's review-thread
 * and general comment reads and thread resolve, PR-12's guarded catch-up rebase that runs
 * after a timed poll, and PR-10's link of an existing pull request by URL or number.
 * Behaviour: services-map.md 3.9 (auth probes, method resolution, health), 5B.1.11 (failure
 * classes; only unauthorized breaks access), 3.7.5 and 5B.1.7 (the write actions, the merge
 * method cached per repo, and one call at a time for each action), 3.7.6 (fixing CI errors goes to
 * the agent as an instruction), 3.8.2 (the stack members, the optional `stackEntry` field, each
 * member's readiness, and `gh stack sync`), 3.8.3 (the guarded automatic catch-up rebase of a
 * rewritten stack branch), 3.0.3 (`gh stack sync` and the catch-up hold the worktree lock, then
 * the repo lock), 3.7.4 and 5A.7.3 (review threads, their extra comment pages, general comments
 * and `resolveReviewThread`), 3.7.2 and 5B.1.2 to 5B.1.4
 * (the PR poll: batched queries per repository, adaptive batch size, cadence, skip rules and
 * rate-limit gate), 2.5.2 and 5B.1.10 (GitHub reads for the workspace pickers), 5B.8.2 (open
 * issues, 50 newest), 5B.8.3 (an issue becomes `[GITHUB]-<n>.md`, a pull request
 * `.context/pull-requests/<n>.md`; PR-09's Link issue dialog adds the same `[GITHUB]-<n>.md` to a
 * chat's draft instead), ui-map.md 3.6 and 6 (the Fix errors action and its repo prompt;
 * Account: GitHub through the `gh` CLI or a personal access token).
 * Must handle: `gh` missing, signed out, unauthorized, offline, an SSO requirement and a missing
 * scope, with the failure class kept on the access state; only unauthorized marks access broken;
 * GH_TOKEN is passed only when the resolved method is pat; a merge is pinned to the local HEAD
 * and refused when HEAD cannot be read, and a head mismatch gets a blocked message instead of the
 * raw `gh` error; auto-merge on is the same merge pinned to HEAD, and auto-merge off is
 * `--disable-auto`; mark ready, edit, reviewer and approve calls refuse a workspace with no PR;
 * every action after the poll (the writes, the base move, the stack read and catch-up, the review
 * sync) acts on the workspace's linked pull request, else the one the poll found for its branch;
 * an approval is pinned to the pull request's head commit; mark ready can take the number of
 * another pull request of the stack, so the stack view marks the row clicked; the merge method
 * follows the repo's allowed methods (squash, then rebase, then merge) and is cached per
 * repository; each action runs once while it is in flight, and the pending action state in the
 * store names it; a write that
 * succeeded polls the workspace before its pending state clears, so the header shows GitHub's new
 * state without waiting for the next timed poll; every write and the base move share one `gh`
 * runner, so their failures are mapped alike; Fix errors refuses when no check failed, reads each
 * failing check's log tail four at a time, strips its terminal escapes and keeps its last 100
 * lines, names the reason when a log could not be read, sends one instruction, and a repository
 * prompt replaces its default text; a token that does not look
 * like one is a warning the caller can confirm, not a refusal, but an empty one is refused; every
 * `gh` result updates the health store; only the newest access check writes the access state; a
 * response the app cannot parse is an error, not an empty list; a context file is reported as
 * written only after the file was written; a poll skips an offline, unlinked or remote-less
 * workspace and leaves its last entry alone, and an offline workspace with no entry yet gets an
 * offline one; a failed budget probe pauses polling and is reported
 * on the workspace; only the newest poll writes a workspace's entry; `dispose` stops every timer;
 * a stack read with no pull request or no stack is an empty answer, an unknown `stackEntry` field
 * is retried without and remembered per remote host, each stack entry carries the restack flag
 * the Graphite service last read for its branch (false before that repository was ever read), its
 * head and base commit ids, and GitHub's merge state from one readiness query for every member
 * (a readiness read that fails leaves every merge state unknown and keeps the stack, as Conductor
 * does; a member without its commit ids is an error), a stack sync runs under the worktree lock
 * and then the repo lock and is refused when the main worktree is not known, a
 * stack sync or stack merge that `gh` answers with an unknown command gets the install message
 * naming that action, a stack sync that prints a cross mark or its abort notice is an error, never
 * a success, and a stack merge runs `gh stack merge` with the repository's first allowed merge
 * method; the automatic catch-up only runs for an open stacked branch the user may write, reads
 * the branch, its head, its upstream and the remote before doing anything, and skips a detached
 * head, a changed identity, a branch that is not diverged, a missing baseline the upstream reflog
 * never held, a dirty tree, another git operation, an ignored file the rebase would overwrite, a
 * branch outside a stack, and a user without write permission; the catch-up moves the branch
 * onto the upstream tip under the worktree lock and then the repo lock, its sequence
 * editor re-checks the branch and remote before git starts, a rebase that stops partway is
 * aborted, and the baseline ref takes the new tip with a compare-and-swap; a catch-up failure is
 * reported to its caller, never recorded as a failed poll, and the same local and upstream tips
 * are not tried again until one moves (a conflict would fail on every poll), and any failure that
 * repeats unchanged is told once; a workspace that
 * stops being watched during the poll or the catch-up is not rebased; the members the last stack read found,
 * with each base branch, are kept per workspace
 * for the range diff scope (PR-08, services-map 3.4.5), which reads the stack itself only when
 * nothing has; a review-comment read needs a pull request
 * and an owner/name GitHub remote, follows every thread page and every thread's extra comment
 * page, and a resolve sends the raw thread id as a variable.
 * Our design choice: access is the user's own `gh auth login`, or the personal access token the
 * user saved on the Account page (D029). The token is kept in the Keychain and given to `gh` as
 * GH_TOKEN; nothing is brokered per session. The poll schedule and gate are pure functions in
 * pr-polling.ts; this file applies them and owns the timers. The poll batch groups workspaces by
 * their repository (the git common dir) so siblings share one `gh api graphql` call. Required
 * check names are not part of the poll answer, so no check is marked required (NO_REQUIRED_CHECKS);
 * the Checks tab's required marks need the branch-protection read. The catch-up runs at the end of
 * a timed poll and reports its own failures through `onCatchUpError`, which the container turns
 * into the "Couldn't catch up the stack branch" toast (our wording); re-running failed checks
 * belongs to PR-04, which owns the Checks tab's button.
 * `gt state` and `gt checkout` run in graphite.ts; the stack read only asks that service for a
 * restack flag. The readiness rules that read the merge states live in
 * core/status/stack-readiness.ts. The
 * sidebar and selected workspace subscriptions belong to the screens that own them; this file
 * calls `onMerged` and the workspace service archives the workspace, and calls
 * `onPullRequestChanged` when an open pull request's `updatedAt` changes so review comments sync.
 * Test first: two merge calls at once send one `gh pr merge`.
 * PR-03 test first: two watched workspaces of one repository ask GitHub in one batched query.
 * PR-05 test first: two failing checks send one instruction with both log tails.
 * PR-06 test first: enabling auto-merge sends `gh pr merge --auto` pinned to the local HEAD.
 * PR-11 test first: an issue with a `pull_request` field is left out of the issues list.
 * PR-08 test first: a stack member list comes back from trunk up with the workspace branch marked
 * as current.
 * PR-12 test first: a diverged stack branch whose local tip the upstream reflog once held is
 * rebased onto the rewritten upstream, and the baseline ref takes the new tip.
 * PR-10 test first: a full pull request URL and a bare number both store the same pull request
 * number on the workspace, and a URL for another repository is refused without asking GitHub.
 */

import {
	type AppError,
	appError,
	err,
	messageOf,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Keychain, ShellOutput, Unsubscribe } from "../../platform/platform.ts";
import { stripTerminalEscapes } from "../../platform/terminal-escapes.ts";
import { createLatestWins, type LatestTicket } from "../async/latest-wins.ts";
import { createSingleFlight, type SingleFlight } from "../async/single-flight.ts";
import {
	configGet,
	diffTreeAddedNul,
	type GitCommand,
	hashObjectStdin,
	lsFiles,
	lsFilesIgnoredNul,
	rebaseOntoUpstream,
	remoteGetUrl,
	revParseGitCommonDir,
	revParseHead,
	revParseVerify,
	statusPorcelainAll,
	symbolicRefHead,
	updateRefStdin,
	upstreamFullName,
} from "../git/commands.ts";
import {
	apiRateLimit,
	apiUserLogin,
	authStatus,
	configGetGitProtocol,
	generalCommentsQuery,
	githubOwnerRepositories,
	githubUserOrganizations,
	issueByNumber as issueByNumberCommand,
	type MergeMethod,
	prApprove,
	prBatchQuery,
	prCreateWeb,
	prEdit,
	prMerge,
	prMergeDisableAuto,
	prReady,
	prStackQuery,
	prViewHeadCommit,
	prViewState,
	pullRequestByNumber as pullRequestByNumberCommand,
	recentRepositories,
	repoCanView,
	repoMergeMethodsQuery,
	repositoryIssues,
	repositoryPullRequests,
	resolveReviewThread as resolveReviewThreadCommand,
	reviewThreadCommentsQuery,
	reviewThreadsQuery,
	stackMembers,
	stackMerge,
	stackReadinessQuery,
	stackSync,
} from "../git/gh-commands.ts";
import {
	failedCommandError,
	type GitRunner,
	type GitRunOptions,
	isSuccessfulExit,
} from "../git/runner.ts";
import {
	catchUpGuardEnv,
	hasIgnoredPathCollision,
	parseNulPaths,
	rebaseAbortCommand,
	syncedBaselineRef,
} from "../git/stack-catch-up.ts";
import { readOperation, readUpstreamDivergence } from "../git/status.ts";
import type {
	CheckRun,
	GitHubAccess as GitHubAccessView,
	GitHubOwner,
	GitHubRepoSummary,
	IssueView,
	MergeStateStatus,
	PullRequest,
	PullRequestAction,
	PullRequestSummary,
	RepoNameCheck,
	StackEntryView,
} from "../model.ts";
import {
	createPrInstruction,
	type FailingCheck,
	fixErrorsInstruction,
} from "./agent-instructions.ts";
import { parseTargetBranch } from "./git.ts";
import { buildDeepLink } from "./notifications.ts";
import {
	closedPrIsShown,
	type GraphqlPullRequestNode,
	headBranchFromUpstream,
	type PullRequestExtras,
	pullRequestStateOf,
	rawFromGraphql,
	reconcileMergeable,
	toDeployments,
	toPullRequest,
	toReviewers,
} from "./pr-mapping.ts";
import {
	createRateLimitGate,
	effectiveBatchSize,
	initialBatchSizes,
	NO_PR_MEMORY_MS,
	nextBatchSizes,
	type PollRole,
	type PollSubscription,
	pollSkipReason,
	type RateLimitGate,
	requestedInterval,
	shouldQueryPr,
} from "./pr-polling.ts";
import { projectFolderName } from "./project-templates.ts";
import type { AgentMessenger } from "./sessions.ts";

/** The paths GitHub reads a pull request template from, in the order the research lists them. */
export const PR_TEMPLATE_PATHS = [
	"pull_request_template.md",
	".github/pull_request_template.md",
	"docs/pull_request_template.md",
] as const;

/** The Keychain entry the Account page writes and `gh` receives as GH_TOKEN (D029). */
export const GH_PAT_KEYCHAIN_KEY = "gh_pat_token";
/** Shown by the Account page when the text in the token field is not shaped like a GitHub token. */
export const GITHUB_TOKEN_WARNING = "That doesn't look like a GitHub token. Are you sure?";
/** Shown when a refresh of GitHub data fails for a reason the service cannot classify. */
export const GITHUB_REFRESH_FAILED_MESSAGE = "Couldn't refresh GitHub";
export const GITHUB_UNAUTHORIZED_MESSAGE = "Reconnect GitHub in Settings to keep pushing changes.";
export const GITHUB_SAML_SSO_MESSAGE =
	"GitHub requires single sign-on for this organization. Authorize your account for the organization, then try again.";
/** Shown when the workspace's HEAD is not the pull request's head, so a merge would act on other code. */
export const GITHUB_HEAD_MISMATCH_MESSAGE =
	"Merge blocked: this workspace's code is different from the pull request's head. Pull the latest changes and try again.";

export type GithubAuthMethod = "cli" | "pat";
export type GithubFailureClass =
	| "unauthorized"
	| "saml-sso-required"
	| "missing-scope"
	| "offline"
	| "other";

export type GithubAccess =
	| { status: "unknown"; reason?: "check_failed" }
	| {
			status: "ok";
			login: string;
			host: string;
			scopes: string[];
			usesToken: boolean;
			gitProtocol: string | null;
	  }
	| { status: "gh_missing" }
	/** `failure` keeps a class the UI must explain, such as an SSO requirement or a missing scope. */
	| { status: "signed_out"; failure?: GithubFailureClass }
	| { status: "unauthorized" }
	| { status: "offline" };

/** What the health check keeps about GitHub access (services-map 5B.1.11). */
export interface GithubHealth {
	status: "unknown" | "ok" | "broken";
	reason: GithubFailureClass | null;
	authMethod: GithubAuthMethod;
	lastSuccessAtMs: number | null;
	lastFailureAtMs: number | null;
}

// ---------------------------------------------------------------- pure access helpers

/**
 * The class of a `gh` failure, from its output. Unauthorized means the sign-in is no longer
 * accepted; the other classes tell the user what to fix.
 */
export function classifyGhFailure(text: string): GithubFailureClass {
	const lower = text.toLowerCase();
	if (/bad credentials|http 401|"status"\s*:\s*"?401|status\s*:?\s*401/.test(lower)) {
		return "unauthorized";
	}
	if (/saml enforcement|saml sso|saml-sso|requires saml|sso for this organization/.test(lower)) {
		return "saml-sso-required";
	}
	if (/(\b403\b|forbidden)/.test(lower) && /scope/.test(lower)) {
		return "missing-scope";
	}
	if (
		/could not resolve host|connection refused|network is unreachable|no such host|temporary failure in name resolution|dial tcp|timed out|timeout/.test(
			lower,
		)
	) {
		return "offline";
	}
	return "other";
}

/**
 * The scope the failure says is missing, when GitHub names one. The Account page and the toast
 * use it to say exactly which scope to add.
 */
export function missingScopeFrom(text: string): string | null {
	const accepted = /x-accepted-oauth-scopes:\s*([^\r\n]+)/i.exec(text);
	if (accepted !== null) return accepted[1]?.split(",")[0]?.trim() ?? null;
	const quoted = /scope[^.\r\n]{0,120}?["'`]([a-z][a-z0-9:_-]*)["'`]/i.exec(text);
	if (quoted !== null) return quoted[1] ?? null;
	const known =
		/(?:needs|requires|missing|add)[^.\r\n]{0,80}?\b(repo|gist|workflow|notifications|user|project|read:org|write:org|admin:org|read:packages|write:packages|delete:packages|read:discussion|write:discussion|read:project|write:project|codespace)\b["'`]?\s+scope/i.exec(
			text,
		);
	return known?.[1] ?? null;
}

/** The sentence the UI shows for a classified failure. Null when the class needs no message. */
export function githubFailureMessage(failure: GithubFailureClass, text: string): string | null {
	switch (failure) {
		case "unauthorized":
			return GITHUB_UNAUTHORIZED_MESSAGE;
		case "saml-sso-required":
			return GITHUB_SAML_SSO_MESSAGE;
		case "missing-scope": {
			const scope = missingScopeFrom(text);
			return scope === null
				? "GitHub access is missing a scope this action needs. Add it to your token and try again."
				: `GitHub access is missing the "${scope}" scope. Add it to your token and try again.`;
		}
		default:
			return null;
	}
}

export interface ParsedAuthStatus {
	login: string | null;
	host: string | null;
	scopes: string[];
}

/** Reads the signed-in account, host and token scopes out of `gh auth status` output. */
export function parseAuthStatus(text: string): ParsedAuthStatus {
	const modern = /logged in to (\S+) account (\S+)/i.exec(text);
	const older = /logged in to (\S+) as (\S+)/i.exec(text);
	const match = modern ?? older;
	const scopesLine = /token scopes:\s*([^\r\n]+)/i.exec(text);
	const scopesText = scopesLine?.[1] ?? "";
	const scopes = scopesText
		.split(",")
		.map((scope) => scope.trim().replace(/^['"`]|['"`]$/g, ""))
		.filter((scope) => scope.length > 0 && scope.toLowerCase() !== "none");
	return { login: match?.[2] ?? null, host: match?.[1] ?? null, scopes };
}

/**
 * Whether a remote URL points at GitHub. Only github.com and ssh.github.com get the GitHub forge;
 * every other host is treated as local git (services-map 3.1).
 */
export function isGithubRemoteUrl(url: string): boolean {
	const trimmed = url.trim();
	if (trimmed.length === 0) return false;
	const scp = hasUrlScheme(trimmed) ? null : SCP_LIKE_REMOTE.exec(trimmed);
	if (scp !== null) return isGithubHost(scp[1]);
	try {
		return isGithubHost(new URL(trimmed).hostname);
	} catch {
		return false;
	}
}

/** Whether the text names a URL with a scheme, such as `https://` or `ssh://`. */
const hasUrlScheme = (url: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url);

/** git's scp-like remote, `user@host:owner/repo`. Only used when there is no URL scheme. */
const SCP_LIKE_REMOTE = /^[^@\s]+@([^:\s/]+):(.+)$/;

const isGithubHost = (host: string | undefined): boolean => {
	const name = (host ?? "").toLowerCase();
	return name === "github.com" || name === "ssh.github.com";
};

/**
 * The forge a remote gets: GitHub for github.com only, local git for everything else, and local
 * git for a repository with no remote at all (null). The one home of this rule.
 */
export function forgeForRemoteUrl(url: string | null): "github" | "local" {
	return url !== null && isGithubRemoteUrl(url) ? "github" : "local";
}

/** The owner and repository name GitHub needs for its REST paths. */
export interface GithubRepository {
	owner: string;
	name: string;
}

const NOT_GITHUB_REMOTE = "This repository has no GitHub remote.";

/** A GitHub remote: the host it names and the repository's owner and name. */
interface GithubRemote extends GithubRepository {
	/** The host name, lower case, for example "github.com" or "ssh.github.com". */
	host: string;
}

/**
 * Reads `owner/name` out of a GitHub remote URL, in any of the shapes git stores: HTTPS, scp-like
 * SSH and an ssh:// URL. Every other host is refused, the same rule as `isGithubRemoteUrl`.
 */
export function githubRepositoryFromRemote(url: string): Result<GithubRepository> {
	const remote = githubRemoteFromUrl(url);
	return remote.ok ? ok({ owner: remote.value.owner, name: remote.value.name }) : remote;
}

/** The one parser behind `githubRepositoryFromRemote`, keeping the host as well. */
function githubRemoteFromUrl(url: string): Result<GithubRemote> {
	const trimmed = url.trim();
	if (trimmed === "") return err(appError("github_not_github", NOT_GITHUB_REMOTE));
	let host: string;
	let path: string;
	const scp = hasUrlScheme(trimmed) ? null : SCP_LIKE_REMOTE.exec(trimmed);
	if (scp !== null) {
		host = scp[1] ?? "";
		path = scp[2] ?? "";
	} else {
		let parsed: URL;
		try {
			parsed = new URL(trimmed);
		} catch {
			return err(appError("github_not_github", NOT_GITHUB_REMOTE));
		}
		host = parsed.hostname;
		path = parsed.pathname;
	}
	if (!isGithubHost(host)) return err(appError("github_not_github", NOT_GITHUB_REMOTE));
	const parts = path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/i, "")
		.split("/")
		.filter((part) => part.length > 0);
	const owner = parts[0];
	const name = parts[1];
	if (owner === undefined || name === undefined) {
		return err(appError("github_not_github", NOT_GITHUB_REMOTE));
	}
	return ok({ host: host.toLowerCase(), owner, name });
}

/** Whether the issues tab may ask GitHub for this repository (services-map 5B.8.2). */
export function canListGithubIssues(remoteUrl: string | null, access: GithubAccess): boolean {
	return remoteUrl !== null && isGithubRemoteUrl(remoteUrl) && access.status === "ok";
}

/** Whether the pull request picker may ask GitHub for this repository. */
export function canListGithubPullRequests(remoteUrl: string | null): boolean {
	return remoteUrl !== null && isGithubRemoteUrl(remoteUrl);
}

function repositoryPath(repository: GithubRepository): string {
	return `${repository.owner}/${repository.name}`;
}

function issueNumber(id: string): Result<number> {
	const trimmed = id.trim();
	const parsed = Number.parseInt(trimmed, 10);
	if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(parsed) || parsed <= 0) {
		return err(appError("github_issue_invalid", "That is not a GitHub issue number."));
	}
	return ok(parsed);
}

/** A pull request number typed by the user, and the repository a URL named when it gave one. */
export interface PullRequestInput {
	number: number;
	/** The repository in a URL, or null for a bare number. */
	repository: GithubRepository | null;
}

/**
 * Reads a pull request number from the text of the Link pull request dialog: a bare number, `#123`,
 * or a GitHub pull request URL. A URL keeps its repository so the caller can refuse a link from
 * another repository before asking GitHub.
 */
export function pullRequestInput(text: string): Result<PullRequestInput> {
	const trimmed = text.trim();
	const bare = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
	if (/^\d+$/.test(bare)) {
		const number = Number(bare);
		if (!Number.isSafeInteger(number) || number <= 0) return err(invalidPullRequestInput());
		return ok({ number, repository: null });
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return err(invalidPullRequestInput());
	}
	if (!isGithubHost(url.hostname)) return err(invalidPullRequestInput());
	const parts = url.pathname.split("/").filter((part) => part.length > 0);
	const [owner, name, kind, numberText] = parts;
	if (owner === undefined || name === undefined || kind !== "pull" || numberText === undefined) {
		return err(invalidPullRequestInput());
	}
	if (!/^\d+$/.test(numberText)) return err(invalidPullRequestInput());
	const number = Number(numberText);
	if (!Number.isSafeInteger(number) || number <= 0) return err(invalidPullRequestInput());
	return ok({ number, repository: { owner, name } });
}

function invalidPullRequestInput(): AppError {
	return appError("github_pr_invalid", "Enter a pull request number or a GitHub pull request URL.");
}

// ---------------------------------------------------------------- REST responses

export interface GithubIssueRecord {
	view: IssueView;
	body: string | null;
	/** GitHub's issue endpoint also returns pull requests, marked by this field. */
	pullRequest: boolean;
}

export interface GithubPullRequestRecord extends PullRequestSummary {
	url: string;
	body: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const responseInvalid = (): AppError =>
	appError("github_response_invalid", "GitHub sent a response the app could not read.");

function parseJson(text: string): Result<unknown> {
	try {
		return ok(JSON.parse(text));
	} catch (error) {
		return err(
			appError("github_response_invalid", "GitHub sent a response the app could not read.", error),
		);
	}
}

function stringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function parseTimestamp(text: string | null): number | null {
	if (text === null) return null;
	const at = Date.parse(text);
	return Number.isNaN(at) ? null : at;
}

function parseIssueRecord(raw: unknown): Result<GithubIssueRecord> {
	if (!isRecord(raw)) return err(responseInvalid());
	const number = raw.number;
	const title = stringField(raw, "title");
	const url = stringField(raw, "html_url");
	const state = stringField(raw, "state");
	const updatedAt = parseTimestamp(stringField(raw, "updated_at"));
	if (
		typeof number !== "number" ||
		!Number.isSafeInteger(number) ||
		title === null ||
		url === null ||
		state === null ||
		updatedAt === null
	) {
		return err(responseInvalid());
	}
	return ok({
		view: {
			provider: "github",
			id: String(number),
			identifier: `#${number}`,
			title,
			url,
			state,
			branchName: null,
			updatedAt,
		},
		body: stringField(raw, "body"),
		pullRequest: raw.pull_request !== undefined && raw.pull_request !== null,
	});
}

function parsePullRequestRecord(raw: unknown): Result<GithubPullRequestRecord> {
	if (!isRecord(raw)) return err(responseInvalid());
	const number = raw.number;
	const title = stringField(raw, "title");
	const updatedAt = parseTimestamp(stringField(raw, "updated_at"));
	const url = stringField(raw, "html_url");
	const head = raw.head;
	const branch = isRecord(head) ? stringField(head, "ref") : null;
	if (
		typeof number !== "number" ||
		!Number.isSafeInteger(number) ||
		title === null ||
		updatedAt === null ||
		url === null ||
		branch === null
	) {
		return err(responseInvalid());
	}
	const user = raw.user;
	const authorLogin = isRecord(user) ? stringField(user, "login") : null;
	const authorAvatarUrl = isRecord(user) ? stringField(user, "avatar_url") : null;
	const merged = stringField(raw, "merged_at") !== null;
	const draft = raw.draft === true;
	const state = pullRequestStateOf(merged ? "MERGED" : stringField(raw, "state"), draft);
	return ok({
		number,
		title,
		branch,
		authorLogin,
		authorAvatarUrl,
		state,
		updatedAt,
		url,
		body: stringField(raw, "body"),
	});
}

/** Parses the open issues GitHub returned, dropping the pull requests it lists there too. */
export function parseGithubIssues(text: string): Result<IssueView[]> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!Array.isArray(json.value)) return err(responseInvalid());
	const issues: IssueView[] = [];
	for (const item of json.value) {
		if (isRecord(item) && item.pull_request !== undefined && item.pull_request !== null) continue;
		const parsed = parseIssueRecord(item);
		if (!parsed.ok) return err(parsed.error);
		issues.push(parsed.value.view);
	}
	return ok(issues);
}

/** Parses the single issue or pull request from its number endpoint. */
export function parseGithubIssue(text: string): Result<GithubIssueRecord> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	return parseIssueRecord(json.value);
}

export function parseGithubPullRequests(text: string): Result<PullRequestSummary[]> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!Array.isArray(json.value)) return err(responseInvalid());
	const rows: PullRequestSummary[] = [];
	for (const item of json.value) {
		const parsed = parsePullRequestRecord(item);
		if (!parsed.ok) return err(parsed.error);
		rows.push({
			number: parsed.value.number,
			title: parsed.value.title,
			branch: parsed.value.branch,
			authorLogin: parsed.value.authorLogin,
			authorAvatarUrl: parsed.value.authorAvatarUrl,
			state: parsed.value.state,
			updatedAt: parsed.value.updatedAt,
		});
	}
	return ok(rows);
}

export function parseGithubPullRequest(text: string): Result<GithubPullRequestRecord> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	return parsePullRequestRecord(json.value);
}

/** The stack a pull request reports, without its members. */
export interface PrStackInfo {
	number: number;
	size: number;
	position: number;
	baseRefName: string | null;
}

/** One member of a GitHub stack, as the members endpoint reports it. */
export interface StackMember {
	number: number;
	title: string;
	branch: string;
	state: StackEntryView["state"];
	headSha: string;
	baseSha: string;
	/** The branch the pull request merges into, which a range fetches when its commit is missing. */
	baseBranch: string;
}

/**
 * Reads the optional `stackEntry` out of the pull request answer. A null entry means the pull
 * request is not in a stack, which is a normal answer, not an error.
 */
export function parsePrStackEntry(text: string): Result<PrStackInfo | null> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!isRecord(json.value)) return err(responseInvalid());
	const data = json.value.data;
	if (!isRecord(data)) return err(responseInvalid());
	const repository = data.repository;
	if (!isRecord(repository)) return err(responseInvalid());
	const pullRequest = repository.pullRequest;
	if (!isRecord(pullRequest)) return err(responseInvalid());
	const entry = pullRequest.stackEntry;
	if (entry === undefined || entry === null) return ok(null);
	if (!isRecord(entry)) return err(responseInvalid());
	const stack = entry.stack;
	if (!isRecord(stack)) return err(responseInvalid());
	const number = stack.number;
	const size = stack.size;
	if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) {
		return err(responseInvalid());
	}
	if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
		return err(responseInvalid());
	}
	const position = entry.position;
	return ok({
		number,
		size,
		position: typeof position === "number" ? position : 0,
		baseRefName: stringField(stack, "baseRefName"),
	});
}

/** The stack commands, named as the install message names them. */
export type StackAction = "Syncing" | "Merging";

/** The message shown when `gh stack` is not installed, naming what needed it (services-map 3.8.2). */
export function stackExtensionMessage(action: StackAction): string {
	return `${action} a stack needs GitHub's stack extension. Install it with \`gh extension install github/gh-stack\`.`;
}

/** Whether `gh` said it does not know the `stack` command. */
export function isStackExtensionMissing(text: string): boolean {
	return /unknown command[^\n]*\bstack\b|\bstack\b[^\n]*unknown command|is not a gh command/i.test(
		text,
	);
}

/** Whether a stack sync stopped partway: a line starting with a cross mark, or its abort notice. */
export function hasStackSyncAbort(text: string): boolean {
	return /^\s*✗/m.test(text) || /Sync aborted/i.test(text);
}

/** Whether a GraphQL failure is the optional `stackEntry` field being unknown to this host. */
export function isUndefinedStackFieldError(message: string): boolean {
	return /undefinedField|undefinedType|Cannot query field ["']?stackEntry|Field ["']?stackEntry["']? doesn't exist|does not exist on type/i.test(
		message,
	);
}

/** Reads the members of a GitHub stack, in the order the endpoint reports them. */
export function parseStackMembers(text: string): Result<StackMember[]> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!isRecord(json.value)) return err(responseInvalid());
	const list = json.value.pull_requests;
	if (!Array.isArray(list)) return err(responseInvalid());
	const members: StackMember[] = [];
	for (const item of list) {
		if (!isRecord(item)) return err(responseInvalid());
		const number = item.number;
		const title = stringField(item, "title");
		const head = item.head;
		const base = item.base;
		const branch = isRecord(head) ? stringField(head, "ref") : null;
		const headSha = isRecord(head) ? stringField(head, "sha") : null;
		const baseSha = isRecord(base) ? stringField(base, "sha") : null;
		const baseBranch = isRecord(base) ? stringField(base, "ref") : null;
		if (
			typeof number !== "number" ||
			!Number.isSafeInteger(number) ||
			number <= 0 ||
			title === null ||
			branch === null ||
			headSha === null ||
			baseSha === null ||
			baseBranch === null
		) {
			return err(responseInvalid());
		}
		const merged = stringField(item, "merged_at") !== null;
		const state = pullRequestStateOf(
			merged ? "MERGED" : stringField(item, "state"),
			item.draft === true,
		);
		members.push({ number, title, branch, state, headSha, baseSha, baseBranch });
	}
	return ok(members);
}

const MERGE_STATE_STATUSES: readonly MergeStateStatus[] = [
	"CLEAN",
	"DIRTY",
	"BEHIND",
	"UNSTABLE",
	"BLOCKED",
	"DRAFT",
	"HAS_HOOKS",
	"UNKNOWN",
];

function isMergeStateStatus(value: unknown): value is MergeStateStatus {
	return MERGE_STATE_STATUSES.some((status) => status === value);
}

/**
 * Reads the answer of `stackReadinessQuery`: GitHub's merge state by pull request number. A null
 * alias (a pull request GitHub did not return) is left out; any other shape is an error.
 */
export function parseStackReadiness(text: string): Result<Map<number, MergeStateStatus>> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!isRecord(json.value)) return err(responseInvalid());
	const data = json.value.data;
	if (!isRecord(data)) return err(responseInvalid());
	const repository = data.repository;
	if (!isRecord(repository)) return err(responseInvalid());
	const statuses = new Map<number, MergeStateStatus>();
	for (const pullRequest of Object.values(repository)) {
		if (pullRequest === null) continue;
		if (!isRecord(pullRequest)) return err(responseInvalid());
		const number = pullRequest.number;
		const status = pullRequest.mergeStateStatus;
		if (typeof number !== "number" || !isMergeStateStatus(status)) return err(responseInvalid());
		statuses.set(number, status);
	}
	return ok(statuses);
}

export function parseGithubRepos(text: string): Result<GitHubRepoSummary[]> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!Array.isArray(json.value)) return err(responseInvalid());
	const repos: GitHubRepoSummary[] = [];
	for (const item of json.value) {
		if (!isRecord(item)) return err(responseInvalid());
		const name = stringField(item, "name");
		const cloneUrl = stringField(item, "clone_url");
		const updatedAt = parseTimestamp(stringField(item, "updated_at"));
		const owner = item.owner;
		const login = isRecord(owner) ? stringField(owner, "login") : null;
		if (name === null || cloneUrl === null || updatedAt === null || login === null) {
			return err(responseInvalid());
		}
		repos.push({
			owner: login,
			name,
			description: stringField(item, "description"),
			isPrivate: item.private === true,
			cloneUrl,
			updatedAt,
		});
	}
	return ok(repos);
}

// ---------------------------------------------------------------- context files

/** Replaces everything GitHub does not allow in a folder name (services-map 5B.8.3). */
export function sanitizeIssueKey(key: string): string {
	return key.replace(/[^A-Za-z0-9._-]/g, "-");
}

/** Relative path of a GitHub issue's context file inside a workspace. */
export function githubIssueContextPath(id: string): string {
	return `.context/attachments/${sanitizeIssueKey(`github:${id}`)}/${githubIssueFileName(id)}`;
}

/** Relative path of a pull request's context file inside a workspace. */
export function pullRequestContextPath(number: number): string {
	return `.context/pull-requests/${number}.md`;
}

/** A linked issue as a text attachment for a chat's draft (PR-09's Link issue dialog). */
export interface IssueAttachment {
	fileName: string;
	text: string;
	/** The branch name the provider suggests for the issue, when it has one (Linear). */
	branchName: string | null;
}

/** The file name a GitHub issue's context file has, here and as a chat attachment. */
export function githubIssueFileName(id: string): string {
	return `[GITHUB]-${id}.md`;
}

export function githubIssueContextFile(record: GithubIssueRecord): string {
	const body = record.body?.trim() ?? "";
	return `# ${record.view.identifier}: ${record.view.title}\n\n- Source: ${record.view.url}\n- State: ${record.view.state}\n\n${body.length > 0 ? body : "No description."}\n`;
}

export function githubPullRequestContextFile(record: GithubPullRequestRecord): string {
	const body = record.body?.trim() ?? "";
	return `# Pull request #${record.number}: ${record.title}\n\n- Source: ${record.url}\n- State: ${record.state}\n- Branch: ${record.branch}\n\n${body.length > 0 ? body : "No description."}\n`;
}

function absolutePath(root: string, relative: string): string {
	return `${root.replace(/\/+$/, "")}/${relative}`;
}

function matchesQuery(query: string, values: readonly string[]): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	return values.some((value) => value.toLowerCase().includes(needle));
}

/**
 * The repository's pull request template, when it has one. GitHub looks for the three names
 * below; the comparison ignores case because GitHub's does too.
 */
export function findPrTemplate(paths: readonly string[]): string | null {
	const byLower = new Map(paths.map((path) => [path.toLowerCase(), path]));
	for (const candidate of PR_TEMPLATE_PATHS) {
		const found = byLower.get(candidate);
		if (found !== undefined) return found;
	}
	return null;
}

/**
 * The sign-in method Conductor offers (D029): an explicit `gh_auth_method` wins, otherwise a
 * saved token means pat and nothing saved means the user's own gh login.
 */
export function resolveGhAuthMethod(
	explicit: string | null | undefined,
	hasStoredToken: boolean,
): GithubAuthMethod {
	return explicit === "cli" || explicit === "pat" ? explicit : hasStoredToken ? "pat" : "cli";
}

/**
 * GitHub's personal access tokens start with a known prefix. A guard against a pasted password or
 * a half-copied value, not a validation: only GitHub can say whether a token works.
 */
export function looksLikeGithubToken(token: string): boolean {
	const trimmed = token.trim();
	return /^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(trimmed);
}

/**
 * The warning the Account page shows before saving a value that is not shaped like a GitHub
 * token. Null when the value looks right. Saving is the caller's decision after the user
 * confirms, because an enterprise token can have an unexpected prefix.
 */
export function githubTokenWarning(token: string): string | null {
	return looksLikeGithubToken(token) ? null : GITHUB_TOKEN_WARNING;
}

/** The merge method GitHub allows, in Conductor's preference order (services-map 5B.1.7). */
export function chooseMergeMethod(output: string): MergeMethod | null {
	let allowed: unknown;
	try {
		allowed = JSON.parse(output);
	} catch {
		return null;
	}
	if (!Array.isArray(allowed)) return null;
	if (allowed[0] === true) return "squash";
	if (allowed[1] === true) return "rebase";
	if (allowed[2] === true) return "merge";
	return null;
}

/** Whether `gh pr merge --match-head-commit` refused because the PR head moved since the local HEAD. */
export function isHeadMismatchFailure(text: string): boolean {
	const lower = text.toLowerCase();
	if (!lower.includes("head")) return false;
	return /does not match|doesn't match|doesn't equal|does not equal|differs|mismatch|not the head|isn't the head|not the same as/.test(
		lower,
	);
}

/** Maps the service's access state to the shape the Account page reads (model.ts). */
export function toGitHubAccessView(access: GithubAccess): GitHubAccessView {
	switch (access.status) {
		case "ok":
			return {
				state: "signed_in",
				login: access.login,
				host: access.host,
				scopes: access.scopes,
				usesToken: access.usesToken,
			};
		case "gh_missing":
			return { state: "gh_missing" };
		// A rejected sign-in is fixed the same way as a sign-out, so the page offers that command.
		case "signed_out":
		case "unauthorized":
			return { state: "signed_out" };
		case "offline":
			return { state: "unknown", reason: "offline" };
		case "unknown":
			return { state: "unknown", reason: "check_failed" };
	}
}

/** The access a probe that could not run means: no `gh` program, or a check that failed. */
function accessFromProbeError(code: string): GithubAccess {
	return code === "process_spawn"
		? { status: "gh_missing" }
		: { status: "unknown", reason: "check_failed" };
}

/** The access state a failed probe means. Only the failure class changes the answer. */
function accessFromFailure(text: string): GithubAccess {
	const failure = classifyGhFailure(text);
	if (failure === "unauthorized") return { status: "unauthorized" };
	if (failure === "offline") return { status: "offline" };
	if (failure === "saml-sso-required" || failure === "missing-scope") {
		return { status: "signed_out", failure };
	}
	return { status: "signed_out" };
}

/** Reads the organisation logins `gh api user/orgs` prints, one per line, without repeats. */
export function parseGithubOrgLogins(text: string): string[] {
	const seen = new Set<string>();
	const logins: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const login = line.trim();
		if (login === "" || seen.has(login)) continue;
		seen.add(login);
		logins.push(login);
	}
	return logins;
}

/** The signed-in account first, then its organisations, as the owner picker shows them. */
export function githubOwnersFrom(
	login: string | null,
	organisations: readonly string[],
): GitHubOwner[] {
	const owners: GitHubOwner[] = [];
	if (login !== null && login !== "") {
		owners.push({ login, kind: "user", avatarUrl: null });
	}
	for (const organisation of organisations) {
		if (organisation === login) continue;
		owners.push({ login: organisation, kind: "organization", avatarUrl: null });
	}
	return owners;
}

interface RawGithubRepository {
	name?: unknown;
	owner?: { login?: unknown } | null;
	description?: unknown;
	isPrivate?: unknown;
	sshUrl?: unknown;
	url?: unknown;
	updatedAt?: unknown;
}

/** Reads `gh repo list --json` output. A shape it does not understand is an error, not an empty list. */
export function parseGithubRepositories(text: string): Result<GitHubRepoSummary[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err(appError("github_response_invalid", "GitHub's repository list could not be read."));
	}
	if (!Array.isArray(parsed)) {
		return err(appError("github_response_invalid", "GitHub's repository list could not be read."));
	}
	const repositories: GitHubRepoSummary[] = [];
	for (const entry of parsed) {
		if (typeof entry !== "object" || entry === null) {
			return err(
				appError("github_response_invalid", "GitHub's repository list could not be read."),
			);
		}
		const raw = entry as RawGithubRepository;
		const name = typeof raw.name === "string" ? raw.name : "";
		const owner =
			typeof raw.owner === "object" &&
			raw.owner !== null &&
			typeof raw.owner.login === "string" &&
			raw.owner.login !== ""
				? raw.owner.login
				: "";
		if (name === "" || owner === "" || typeof raw.isPrivate !== "boolean") {
			return err(
				appError("github_response_invalid", "GitHub's repository list could not be read."),
			);
		}
		const updatedAtMs = typeof raw.updatedAt === "string" ? Date.parse(raw.updatedAt) : Number.NaN;
		if (!Number.isFinite(updatedAtMs)) {
			return err(
				appError("github_response_invalid", "GitHub's repository list could not be read."),
			);
		}
		const sshUrl = typeof raw.sshUrl === "string" && raw.sshUrl !== "" ? raw.sshUrl : null;
		const webUrl = typeof raw.url === "string" && raw.url !== "" ? raw.url : null;
		repositories.push({
			owner,
			name,
			description: typeof raw.description === "string" ? raw.description : null,
			isPrivate: raw.isPrivate,
			cloneUrl: sshUrl ?? webUrl ?? `https://github.com/${owner}/${name}.git`,
			updatedAt: updatedAtMs,
		});
	}
	return ok(repositories);
}

/** The error a `gh` command that did not succeed means, with its classified message when it has one. */
function ghCommandError(command: GitCommand, output: ShellOutput): AppError {
	const text = `${output.stderr}\n${output.stdout}`;
	const message = githubFailureMessage(classifyGhFailure(text), text);
	return message === null
		? failedCommandError(command, output)
		: appError("github_failed", message);
}

/** The repositories whose name, owner/name or description contains the query. */
export function filterGithubRepositories(
	repositories: readonly GitHubRepoSummary[],
	query: string,
): GitHubRepoSummary[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...repositories];
	return repositories.filter((repository) => {
		const label = `${repository.owner}/${repository.name}`.toLowerCase();
		const description = (repository.description ?? "").toLowerCase();
		return label.includes(needle) || description.includes(needle);
	});
}

export interface WorkspacePrEntry {
	pullRequest: PullRequest | null;
	/** Why there is no PR to show, when there is not. */
	unavailable: "none" | "offline" | "no_github_access" | "not_github" | "loading" | "no_pr";
	fetchedAt: number | null;
}

export interface GithubState {
	access: GithubAccess;
	health: GithubHealth;
	byWorkspace: Readonly<Record<string, WorkspacePrEntry>>;
	/**
	 * The pull request actions running for each workspace, one entry per running action. It lives
	 * in the store so a screen re-renders when an action starts and ends (services-map 5B.1.5).
	 */
	pendingActions: Readonly<Record<string, readonly PullRequestAction[]>>;
}

/** The order the header picks a pending action in when several run at once. */
const PENDING_ACTION_ORDER: readonly PullRequestAction[] = [
	"merging",
	"enabling_auto_merge",
	"disabling_auto_merge",
	"marking_ready",
	"approving",
	"requesting_review",
	"updating",
];

export interface PrWorkspaceContext {
	workspaceId: WorkspaceId;
	workspacePath: string;
	/** The repository's main worktree, where Graphite state is read. */
	repoRootPath?: string;
	branch: string;
	/** Name of the remote, for example "origin". */
	remote: string;
	prNumber: number | null;
	/** The target branch as stored, for example "origin/main". */
	targetBranch?: string;
	/** The repository's custom Create PR prompt, read from its loaded config. */
	customPrompt?: string | null;
}

/** Why a catch-up did not rebase. Every one is a normal answer, not an error. */
export type CatchUpSkipReason =
	| "not_in_stack"
	| "no_write_permission"
	| "not_diverged"
	| "detached_head"
	| "identity_changed"
	| "no_baseline"
	| "dirty_tree"
	| "operation_in_progress"
	| "ignored_file_collision"
	/** The same local and upstream tips failed to catch up before; it waits until one moves. */
	| "failed_before"
	/** Nobody watches the workspace any more (it was closed or archived during the poll). */
	| "watch_stopped";

export type CatchUpOutcome =
	| { kind: "rebased"; newTip: string }
	| { kind: "skipped"; reason: CatchUpSkipReason };

interface GhCallSettings {
	authMethod: GithubAuthMethod;
	/** GH_TOKEN, present only for the pat method. */
	env: Readonly<Record<string, string>> | undefined;
}

export interface GithubServiceDeps {
	git: GitRunner;
	agent: AgentMessenger;
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<PrWorkspaceContext>>;
	/** Called when a PR becomes merged, so the workspace service can archive on merge. */
	onMerged: (workspaceId: WorkspaceId, prNumber: number) => void;
	/**
	 * Called when an open pull request's `updatedAt` changes, so review comments can be synced
	 * (REV-04). The container always supplies it; tests that never poll may leave it out.
	 */
	onPullRequestChanged?: (workspaceId: WorkspaceId) => void;
	/**
	 * Tells the user a failure of the automatic stack catch-up, once per pair of local and upstream
	 * tips. The container always supplies it; tests that never reach a catch-up may leave it out.
	 */
	onCatchUpError?: (workspaceId: WorkspaceId, error: AppError) => void;
	now: () => number;
	/** The Keychain the Account page's token is kept in (D029). */
	keychain?: Pick<Keychain, "get" | "set" | "delete">;
	/** Reads `gh_auth_method` (services-map 3.9, D029). */
	setting?: <T>(key: string) => T;
	/**
	 * The repository's Fix errors prompt, or null when it has none. The container always supplies
	 * it. Tests that never fix errors may leave it out; `fixErrors` returns an error instead of
	 * guessing when it is absent.
	 */
	fixErrorsPromptOf?: (workspaceId: WorkspaceId) => Promise<Result<string | null>>;
	/** Folder for probes that belong to no workspace, normally the user's home folder. */
	probeCwd: string;
	/** Writes a context file into a workspace (PR-11). */
	fs?: Pick<FileSystem, "mkdirp" | "writeTextAtomic">;
	/**
	 * The Graphite stack state, so a stack entry can show its restack flag (PR-08). The container
	 * always supplies it; tests that read no Graphite state may leave it out.
	 */
	graphite?: { needsRestackOf(repoRootPath: string, branch: string): boolean };
	/**
	 * Stores a linked pull request on the workspace (PR-10). The container supplies the workspace
	 * service, which writes the row and its loaded copy. A test that never links may leave it out;
	 * `linkPullRequest` refuses with an error instead of pretending the link was saved.
	 */
	linkPullRequestToWorkspace?: (
		workspaceId: WorkspaceId,
		pr: { number: number; title: string | null; description: string | null },
	) => Promise<Result<void>>;
}

interface PollWatcher {
	readonly roles: Map<PollRole, number>;
	stopped: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

/** One workspace ready to join a PR query: its lookup and the repository it belongs to. */
interface PollTarget {
	readonly workspaceId: WorkspaceId;
	readonly key: string;
	readonly found: PrWorkspaceContext;
	readonly headBranch: string;
	readonly prNumber: number | null;
	readonly repoKey: string;
	readonly now: number;
}

/** The result of deciding whether a workspace can join a query. */
type PollPreparation =
	| { kind: "target"; target: PollTarget }
	| { kind: "settled"; entry: WorkspacePrEntry }
	| { kind: "skip" }
	| { kind: "error"; error: AppError };

interface PrBatchResponse {
	data?: {
		rateLimit?: { cost?: number | null; remaining?: number | null } | null;
		repository?: {
			viewerPermission?: string | null;
			squashMergeAllowed?: boolean;
			rebaseMergeAllowed?: boolean;
			mergeCommitAllowed?: boolean;
			pr0ByNumber?: GraphqlPullRequestNode | null;
			pr0ByBranch?: { nodes?: readonly GraphqlPullRequestNode[] | null } | null;
		} | null;
	};
}

/** A batched answer for several workspaces of one repository, in the order they were asked. */
export interface PrBatchAnswers {
	nodes: readonly (GraphqlPullRequestNode | null)[];
	viewerCanMerge: boolean;
	mergeMethod: "squash" | "rebase" | "merge";
	cost: number | null;
}

interface RepositoryAnswer {
	viewerCanMerge: boolean;
	mergeMethod: "squash" | "rebase" | "merge";
}

function repositoryAnswer(
	repository: NonNullable<PrBatchResponse["data"]>["repository"],
): Result<RepositoryAnswer> {
	if (repository === undefined || repository === null) {
		return err(appError("github_bad_answer", "GitHub's answer had no repository."));
	}
	const permission = repository.viewerPermission ?? "";
	return ok({
		viewerCanMerge: permission === "ADMIN" || permission === "MAINTAIN" || permission === "WRITE",
		mergeMethod:
			repository.squashMergeAllowed === true
				? "squash"
				: repository.rebaseMergeAllowed === true
					? "rebase"
					: "merge",
	});
}

function parseBatchJson(text: string): Result<PrBatchResponse> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err(appError("github_bad_answer", "GitHub's answer was not JSON."));
	}
	if (typeof parsed !== "object" || parsed === null) {
		return err(appError("github_bad_answer", "GitHub's answer was not a JSON object."));
	}
	return ok(parsed as PrBatchResponse);
}

/**
 * Reads one batched `gh api graphql` answer holding `count` lookups. Entry `i` is the node of
 * `pr<i>ByNumber` when the number was bound, else the newest of `pr<i>ByBranch`. A missing alias is
 * `null`, which means "no PR for that workspace".
 */
export function parsePrBatchAnswers(text: string, count: number): Result<PrBatchAnswers> {
	const json = parseBatchJson(text);
	if (!json.ok) return err(json.error);
	const repository = json.value.data?.repository;
	const facts = repositoryAnswer(repository);
	if (!facts.ok) return err(facts.error);
	const cost = json.value.data?.rateLimit?.cost;
	const holder = repository as Record<string, unknown> | null | undefined;
	const nodes: (GraphqlPullRequestNode | null)[] = [];
	for (let index = 0; index < count; index += 1) {
		const byNumber = holder?.[`pr${index}ByNumber`] as GraphqlPullRequestNode | null | undefined;
		const byBranch = holder?.[`pr${index}ByBranch`] as
			| { nodes?: readonly GraphqlPullRequestNode[] | null }
			| null
			| undefined;
		nodes.push(byNumber ?? byBranch?.nodes?.[0] ?? null);
	}
	return ok({
		nodes,
		viewerCanMerge: facts.value.viewerCanMerge,
		mergeMethod: facts.value.mergeMethod,
		cost: typeof cost === "number" ? cost : null,
	});
}

export interface GithubReviewThreadComment {
	/** GraphQL node id, used when GitHub gives no numeric database id. */
	id: string;
	databaseId: number | null;
	body: string;
	url: string | null;
	authorLogin: string | null;
	authorAvatarUrl: string | null;
	createdAt: number;
	updatedAt: number;
	lastEditedAt: number | null;
	diffHunk: string | null;
	replyToId: string | null;
	replyToDatabaseId: number | null;
}

export interface GithubReviewThread {
	id: string;
	isOutdated: boolean;
	isResolved: boolean;
	path: string;
	line: number | null;
	startLine: number | null;
	originalLine: number | null;
	originalStartLine: number | null;
	startDiffSide: "LEFT" | "RIGHT" | null;
	diffSide: "LEFT" | "RIGHT" | null;
	comments: readonly GithubReviewThreadComment[];
	commentsHasNextPage: boolean;
	commentsEndCursor: string | null;
}

export interface GithubGeneralComment {
	id: string;
	databaseId: number;
	body: string;
	url: string | null;
	authorLogin: string | null;
	authorAvatarUrl: string | null;
	createdAt: number;
	updatedAt: number;
	lastEditedAt: number | null;
}

export interface GithubThreadPage {
	threads: readonly GithubReviewThread[];
	hasNextPage: boolean;
	endCursor: string | null;
	cost: number | null;
}

export interface GithubReviewCommentPage {
	comments: readonly GithubReviewThreadComment[];
	hasNextPage: boolean;
	endCursor: string | null;
}

export interface GithubGeneralCommentPage {
	comments: readonly GithubGeneralComment[];
	hasNextPage: boolean;
	endCursor: string | null;
	cost: number | null;
}

function graphqlData(text: string): Result<Record<string, unknown>> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!isRecord(json.value)) return err(responseInvalid());
	const data = json.value.data;
	if (!isRecord(data)) return err(responseInvalid());
	return ok(data);
}

function pullRequestNode(data: Record<string, unknown>): Result<Record<string, unknown>> {
	const repository = data.repository;
	if (!isRecord(repository)) return err(responseInvalid());
	const pullRequest = repository.pullRequest;
	if (!isRecord(pullRequest)) return err(responseInvalid());
	return ok(pullRequest);
}

function pageInfoOf(connection: Record<string, unknown>): {
	hasNextPage: boolean;
	endCursor: string | null;
} {
	const pageInfo = isRecord(connection.pageInfo) ? connection.pageInfo : {};
	return {
		hasNextPage: pageInfo.hasNextPage === true,
		endCursor: stringField(pageInfo, "endCursor"),
	};
}

function numericField(record: Record<string, unknown>, key: string): number | null {
	const value = record[key];
	return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function diffSideOf(value: string | null): "LEFT" | "RIGHT" | null {
	return value === "LEFT" || value === "RIGHT" ? value : null;
}

function parseThreadComment(raw: unknown): Result<GithubReviewThreadComment> {
	if (!isRecord(raw)) return err(responseInvalid());
	const id = stringField(raw, "id");
	const body = stringField(raw, "body");
	const createdAt = parseTimestamp(stringField(raw, "createdAt"));
	if (id === null || body === null || createdAt === null) return err(responseInvalid());
	const updatedAt = parseTimestamp(stringField(raw, "updatedAt")) ?? createdAt;
	const author = isRecord(raw.author) ? raw.author : null;
	const replyTo = isRecord(raw.replyTo) ? raw.replyTo : null;
	return ok({
		id,
		databaseId: numericField(raw, "databaseId"),
		body,
		url: stringField(raw, "url"),
		authorLogin: author === null ? null : stringField(author, "login"),
		authorAvatarUrl: author === null ? null : stringField(author, "avatarUrl"),
		createdAt,
		updatedAt,
		lastEditedAt: parseTimestamp(stringField(raw, "lastEditedAt")),
		diffHunk: stringField(raw, "diffHunk"),
		replyToId: replyTo === null ? null : stringField(replyTo, "id"),
		replyToDatabaseId: replyTo === null ? null : numericField(replyTo, "databaseId"),
	});
}

function parseThreadComments(connection: unknown): Result<GithubReviewCommentPage> {
	if (!isRecord(connection)) return err(responseInvalid());
	const nodes = connection.nodes;
	if (!Array.isArray(nodes)) return err(responseInvalid());
	const comments: GithubReviewThreadComment[] = [];
	for (const node of nodes) {
		const parsed = parseThreadComment(node);
		if (!parsed.ok) return parsed;
		comments.push(parsed.value);
	}
	return ok({ comments, ...pageInfoOf(connection) });
}

/** Reads one `reviewThreads` page (services-map 3.7.4). */
export function parseReviewThreadsAnswer(text: string): Result<GithubThreadPage> {
	const data = graphqlData(text);
	if (!data.ok) return err(data.error);
	const pullRequest = pullRequestNode(data.value);
	if (!pullRequest.ok) return err(pullRequest.error);
	const connection = pullRequest.value.reviewThreads;
	if (!isRecord(connection)) return err(responseInvalid());
	const nodes = connection.nodes;
	if (!Array.isArray(nodes)) return err(responseInvalid());
	const threads: GithubReviewThread[] = [];
	for (const node of nodes) {
		if (!isRecord(node)) return err(responseInvalid());
		const id = stringField(node, "id");
		const path = stringField(node, "path");
		const comments = parseThreadComments(node.comments);
		if (id === null || path === null) return err(responseInvalid());
		if (!comments.ok) return err(comments.error);
		const page = pageInfoOf(node.comments as Record<string, unknown>);
		threads.push({
			id,
			isOutdated: node.isOutdated === true,
			isResolved: node.isResolved === true,
			path,
			line: numericField(node, "line"),
			startLine: numericField(node, "startLine"),
			originalLine: numericField(node, "originalLine"),
			originalStartLine: numericField(node, "originalStartLine"),
			startDiffSide: diffSideOf(stringField(node, "startDiffSide")),
			diffSide: diffSideOf(stringField(node, "diffSide")),
			comments: comments.value.comments,
			commentsHasNextPage: page.hasNextPage,
			commentsEndCursor: page.endCursor,
		});
	}
	const cost = data.value.rateLimit;
	return ok({
		threads,
		...pageInfoOf(connection),
		cost: isRecord(cost) ? numericField(cost, "cost") : null,
	});
}

/** Reads the follow-up page of one thread's comments (services-map 3.7.4). */
export function parseReviewThreadCommentsAnswer(text: string): Result<GithubReviewCommentPage> {
	const json = parseJson(text);
	if (!json.ok) return err(json.error);
	if (!isRecord(json.value)) return err(responseInvalid());
	const data = json.value.data;
	if (!isRecord(data)) return err(responseInvalid());
	const node = data.node;
	if (!isRecord(node)) return err(responseInvalid());
	return parseThreadComments(node.comments);
}

/** Reads one `pullRequest.comments` page, the comments not on a file (services-map 3.7.4). */
export function parseGeneralCommentsAnswer(text: string): Result<GithubGeneralCommentPage> {
	const data = graphqlData(text);
	if (!data.ok) return err(data.error);
	const pullRequest = pullRequestNode(data.value);
	if (!pullRequest.ok) return err(pullRequest.error);
	const connection = pullRequest.value.comments;
	if (!isRecord(connection)) return err(responseInvalid());
	const nodes = connection.nodes;
	if (!Array.isArray(nodes)) return err(responseInvalid());
	const comments: GithubGeneralComment[] = [];
	for (const node of nodes) {
		if (!isRecord(node)) return err(responseInvalid());
		const id = stringField(node, "id");
		const databaseId = numericField(node, "databaseId");
		const body = stringField(node, "body");
		const createdAt = parseTimestamp(stringField(node, "createdAt"));
		if (id === null || databaseId === null || body === null || createdAt === null) {
			return err(responseInvalid());
		}
		const author = isRecord(node.author) ? node.author : null;
		comments.push({
			id,
			databaseId,
			body,
			url: stringField(node, "url"),
			authorLogin: author === null ? null : stringField(author, "login"),
			authorAvatarUrl: author === null ? null : stringField(author, "avatarUrl"),
			createdAt,
			updatedAt: parseTimestamp(stringField(node, "updatedAt")) ?? createdAt,
			lastEditedAt: parseTimestamp(stringField(node, "lastEditedAt")),
		});
	}
	const cost = data.value.rateLimit;
	return ok({
		comments,
		...pageInfoOf(connection),
		cost: isRecord(cost) ? numericField(cost, "cost") : null,
	});
}

/** Required check names are not part of the poll answer, so no check is marked required here. */
const NO_REQUIRED_CHECKS: ReadonlySet<string> = new Set();

/** Turns a thrown poll error into a value, so the timer is re-armed and the user sees the failure. */
function pollCrashError(cause: unknown): AppError {
	return appError("github_poll_crashed", messageOf(cause));
}

/** The GraphQL budget out of `gh api rate_limit`. Null means the host does not rate limit. */
export function parseGraphqlBudget(text: string): Result<number | null> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err(appError("github_bad_answer", "GitHub's rate-limit answer was not JSON."));
	}
	if (typeof parsed !== "object" || parsed === null) {
		return err(appError("github_bad_answer", "GitHub's rate-limit answer was not an object."));
	}
	const remaining = (parsed as { resources?: { graphql?: { remaining?: unknown } } }).resources
		?.graphql?.remaining;
	return ok(typeof remaining === "number" ? remaining : null);
}

/** The workflow run and job ids in a check's details URL, or null when it has no job. */
export function parseCheckJob(detailsUrl: string | null): { runId: string; jobId: string } | null {
	if (detailsUrl === null) return null;
	const match = /\/actions\/runs\/(\d+)\/job\/(\d+)/.exec(detailsUrl);
	const runId = match?.[1];
	const jobId = match?.[2];
	return runId === undefined || jobId === undefined ? null : { runId, jobId };
}

/** The last `maxLines` lines of a log, the part a failed job shows (services-map 3.7.5). */
export function checkLogTail(text: string, maxLines = 1000): string {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return text;
	return lines.slice(lines.length - maxLines).join("\n");
}

/** How many log lines of each failing check go into the Fix errors message. */
export const FIX_ERRORS_LOG_LINES = 100;
/** How many check logs Fix errors reads from GitHub at once. */
export const FIX_ERRORS_LOG_READS = 4;

/**
 * A check log as the Fix errors message shows it: escape sequences removed, because the message
 * is plain text the user reads in the chat, and only the last lines, so several failing checks
 * still make a message of readable length.
 */
export function fixErrorsLogTail(log: string): string {
	return checkLogTail(stripTerminalEscapes(log), FIX_ERRORS_LOG_LINES);
}

/**
 * Runs `work` over `items` with at most `limit` calls at once and keeps the input order. Used to
 * read check logs in parallel without starting one `gh` call per check at the same moment.
 */
async function mapInBatches<T, R>(
	items: readonly T[],
	limit: number,
	work: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	for (let start = 0; start < items.length; start += limit) {
		const batch = await Promise.all(items.slice(start, start + limit).map(work));
		results.push(...batch);
	}
	return results;
}

export class GithubService {
	readonly store: StoreApi<GithubState>;
	readonly #deps: GithubServiceDeps;
	/** Makes each PR action run once while it is in flight (services-map 5B.1.7). */
	readonly #flights: SingleFlight<string>;
	/** Only the newest access check may write `access`; an older one that ends late is dropped. */
	readonly #accessChecks = createLatestWins();
	/** One timer per watched workspace, shared by every role watching it. */
	readonly #pollWatchers = new Map<string, PollWatcher>();
	/** Only the newest poll may write a workspace's entry. */
	readonly #pollLatest = createLatestWins<string>();
	/** When a "this branch has no PR" answer stops being reused. */
	readonly #noPrUntil = new Map<string, number>();
	/**
	 * The local and upstream tips (`<local>:<upstream>`) whose catch-up failed, per watched
	 * workspace. A conflict fails the same way on every poll, so that pair is not tried again until
	 * one tip moves. Removed when a catch-up succeeds or the workspace is no longer watched.
	 */
	readonly #failedCatchUps = new Map<string, string>();
	/**
	 * The last catch-up failure told to the user (`<code>:<message>`), per watched workspace, so a
	 * failure that repeats on every poll is told once. Removed when a catch-up ends without error or
	 * the workspace is no longer watched.
	 */
	readonly #reportedCatchUps = new Map<string, string>();
	/** When each watched workspace last asked GitHub, for the interval check. */
	readonly #lastPolledAt = new Map<string, number>();
	/** The head commit of the last PR shown, for the UNKNOWN mergeability guard. */
	readonly #headByWorkspace = new Map<string, string>();
	/** The git common dir of each workspace, so siblings of one repository share one query. */
	readonly #repoKeyByWorkspace = new Map<string, string>();
	/** Repositories whose batch is running, so two sibling timers cannot ask twice. */
	readonly #pollingRepos = new Set<string>();
	/** Each repository's merge method, read once from GitHub (services-map 3.7.5). */
	readonly #mergeMethodByRepo = new Map<string, MergeMethod>();
	/** The remote hosts that refused the optional `stackEntry` field (services-map 3.7.2). */
	readonly #stackEntryUnsupported = new Set<string>();
	/**
	 * The members the last stack read found, per workspace, for the range diff scope. One entry per
	 * workspace whose stack was read: each read replaces it, a read that finds no stack removes it,
	 * and `dispose` clears them all.
	 */
	readonly #stackMembers = new Map<string, readonly StackMember[]>();
	/** The adaptive batch size: starts at five, halves on a failed query, then grows. */
	#batchSizes = initialBatchSizes();
	readonly #rateGate: RateLimitGate;

	constructor(deps: GithubServiceDeps) {
		this.#deps = deps;
		this.#flights = createSingleFlight<string>();
		this.#rateGate = createRateLimitGate({
			readRemaining: () => this.#readRateLimit(),
			now: () => this.#deps.now(),
		});
		this.store = createStore<GithubState>(() => ({
			access: { status: "unknown" },
			health: {
				status: "unknown",
				reason: null,
				authMethod: "cli",
				lastSuccessAtMs: null,
				lastFailureAtMs: null,
			},
			byWorkspace: {},
			pendingActions: {},
		}));
	}

	/** Runs `gh auth status` and `gh api user`, reads the git protocol, and updates `access`. */
	async checkAccess(): Promise<Result<GithubAccess>> {
		const ticket = this.#accessChecks.begin("access");
		const probed = await this.#probeAccess();
		const latest = this.#accessChecks.isLatest(ticket);
		this.#accessChecks.settle(ticket);
		// A newer check started while this one ran, so its answer owns the store.
		if (!latest) return ok(this.store.getState().access);
		this.#setAccess(probed.ok ? probed.value : { status: "unknown", reason: "check_failed" });
		return probed;
	}

	/** The probes of `checkAccess`. They read the machine and return the access; the store is the caller's. */
	async #probeAccess(): Promise<Result<GithubAccess>> {
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const runOptions = this.#runOptions(settings.value);
		const auth = await this.#deps.git.run(authStatus(), runOptions);
		if (!auth.ok) return ok(accessFromProbeError(auth.error.code));

		const authText = `${auth.value.stderr}\n${auth.value.stdout}`;
		await this.recordGhResult(auth.value);
		if (auth.value.exitCode !== 0) return ok(accessFromFailure(authText));
		if (!/logged in to /i.test(authText)) return ok({ status: "signed_out" });

		const parsed = parseAuthStatus(authText);
		const user = await this.#deps.git.run(apiUserLogin(), runOptions);
		if (!user.ok) return ok(accessFromProbeError(user.error.code));
		await this.recordGhResult(user.value);
		if (user.value.exitCode !== 0) {
			return ok(accessFromFailure(`${user.value.stderr}\n${user.value.stdout}`));
		}
		const login = user.value.stdout.trim();
		if (login.length === 0) return ok({ status: "unknown", reason: "check_failed" });

		const protocol = await this.#deps.git.run(configGetGitProtocol(), runOptions);
		let gitProtocol: string | null = null;
		if (protocol.ok) {
			await this.recordGhResult(protocol.value);
			const value = protocol.value.stdout.trim();
			gitProtocol = protocol.value.exitCode === 0 && value.length > 0 ? value : null;
		}

		return ok({
			status: "ok",
			login,
			host: parsed.host ?? "github.com",
			scopes: parsed.scopes,
			usesToken: settings.value.env !== undefined,
			gitProtocol,
		});
	}

	/**
	 * The pull request action running for a workspace, for the header's progress. It is read from
	 * the store, so a hook that selects it re-renders when an action starts and ends. The state is
	 * layered over the last polled PR, so a button shows its own progress before GitHub answers.
	 */
	pendingAction(workspaceId: WorkspaceId): PullRequestAction | null {
		const running = this.store.getState().pendingActions[String(workspaceId)] ?? [];
		return PENDING_ACTION_ORDER.find((action) => running.includes(action)) ?? null;
	}

	/**
	 * Runs one pull request write action once while it is in flight (services-map 5B.1.7), with
	 * its pending state in the store. After a write that succeeded, the workspace is polled before
	 * the pending state clears, so the header moves from the progress label straight to GitHub's
	 * new state instead of showing the old one until the next timed poll. A failed refresh is
	 * recorded on the workspace's entry by the poll itself, so the write's own result is returned.
	 */
	#writeAction(
		key: string,
		action: PullRequestAction,
		workspaceId: WorkspaceId,
		work: () => Promise<Result<void>>,
	): Promise<Result<void>> {
		return this.#flights.run(`${key}:${workspaceId}`, async () => {
			this.#setPending(workspaceId, action, true);
			try {
				const result = await work();
				if (result.ok) await this.#refreshAfterWrite(workspaceId);
				return result;
			} finally {
				this.#setPending(workspaceId, action, false);
			}
		});
	}

	/**
	 * Polls the workspace once after a write. `pollNow` records its own failure on the workspace's
	 * entry, and a poll that throws is recorded the same way the timed poll records it, so a write
	 * that went through is never reported as failed because the refresh did not.
	 */
	async #refreshAfterWrite(workspaceId: WorkspaceId): Promise<void> {
		try {
			await this.pollNow(workspaceId);
		} catch (cause) {
			this.#recordPollFailure(workspaceId, pollCrashError(cause));
		}
	}

	/** Adds or removes one running action in the workspace's pending list. */
	#setPending(workspaceId: WorkspaceId, action: PullRequestAction, running: boolean): void {
		const id = String(workspaceId);
		this.store.setState((state) => {
			const list = [...(state.pendingActions[id] ?? [])];
			if (running) {
				list.push(action);
			} else {
				const index = list.indexOf(action);
				if (index >= 0) list.splice(index, 1);
			}
			const pendingActions = { ...state.pendingActions };
			if (list.length === 0) delete pendingActions[id];
			else pendingActions[id] = list;
			return { pendingActions };
		});
	}

	/** Backs `Actions.app.recheckGitHubAccess`: runs the access probes again and updates the store. */
	async recheckAccess(): Promise<Result<void>> {
		const result = await this.checkAccess();
		return result.ok
			? ok(undefined)
			: err(appError("github_refresh_failed", GITHUB_REFRESH_FAILED_MESSAGE, result.error));
	}

	/**
	 * The owners the clone picker offers: the signed-in account first, then the user's organisations.
	 * Reads them with `gh api user/orgs --paginate` (services-map 3.9).
	 */
	async listOwners(): Promise<Result<GitHubOwner[]>> {
		const command = githubUserOrganizations();
		const result = await this.#readGh(command);
		if (!result.ok) return err(result.error);
		const access = this.store.getState().access;
		const login = access.status === "ok" ? access.login : null;
		return ok(githubOwnersFrom(login, parseGithubOrgLogins(result.value)));
	}

	/**
	 * One owner's repositories, filtered by the picker's query. `gh repo list` answers in JSON, so a
	 * shape this file cannot read is an error rather than a shorter list.
	 */
	async listRepositories(owner: string, query: string): Promise<Result<GitHubRepoSummary[]>> {
		const trimmedOwner = owner.trim();
		if (trimmedOwner === "") {
			return err(appError("github_owner_missing", "Choose a GitHub account or organisation."));
		}
		const command = githubOwnerRepositories(trimmedOwner);
		const result = await this.#readGh(command);
		if (!result.ok) return err(result.error);
		const parsed = parseGithubRepositories(result.value);
		if (!parsed.ok) return parsed;
		return ok(filterGithubRepositories(parsed.value, query));
	}

	/**
	 * Backs `useRepoNameCheck`: asks `gh repo view` whether an owner already has this repository.
	 * A name with no letters or numbers is invalid before GitHub is asked. A 404 answer means the
	 * name is free; any other failure is reported rather than turned into "available".
	 */
	async checkRepoName(owner: string, name: string): Promise<Result<RepoNameCheck>> {
		const folder = projectFolderName(name);
		if (folder === "") return ok("invalid");
		const trimmedOwner = owner.trim();
		if (trimmedOwner === "") {
			return err(appError("github_owner_missing", "Choose a GitHub account or organisation."));
		}
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const command = repoCanView(`${trimmedOwner}/${folder}`);
		const result = await this.#deps.git.run(command, this.#runOptions(settings.value));
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (result.value.exitCode === 0) return ok("taken");
		const text = `${result.value.stderr}\n${result.value.stdout}`.toLowerCase();
		if (/not found|http 404|could not resolve to a repository/.test(text)) {
			return ok("available");
		}
		return err(ghCommandError(command, result.value));
	}

	/**
	 * Records what one `gh` call did (services-map 5B.1.11). Every action calls this, so the health
	 * store is never stale. Only an unauthorized answer marks access broken.
	 */
	async recordGhResult(output: {
		exitCode: number;
		stdout: string;
		stderr: string;
	}): Promise<void> {
		const authMethod = await this.#authMethod();
		const previous = this.store.getState().health;
		const now = this.#deps.now();
		if (output.exitCode === 0) {
			this.store.setState({
				health: {
					...previous,
					status: "ok",
					reason: null,
					authMethod,
					lastSuccessAtMs: now,
				},
			});
			return;
		}
		const reason = classifyGhFailure(`${output.stderr}\n${output.stdout}`);
		this.store.setState({
			health: {
				...previous,
				status: reason === "unauthorized" ? "broken" : previous.status,
				reason,
				authMethod,
				lastFailureAtMs: now,
			},
		});
	}

	#setAccess(access: GithubAccess): GithubAccess {
		this.store.setState({ access });
		return access;
	}

	#runOptions(settings: GhCallSettings, cwd = this.#deps.probeCwd) {
		return {
			cwd,
			...(settings.env === undefined ? {} : { env: settings.env }),
		};
	}

	async #readToken(): Promise<Result<string | null>> {
		const keychain = this.#deps.keychain;
		if (keychain === undefined) return ok(null);
		return keychain.get(GH_PAT_KEYCHAIN_KEY);
	}

	/**
	 * One place for how a `gh` call is signed in. The saved token is read once and reaches `gh`
	 * only when the resolved method is pat, so an explicit `cli` choice is never overridden by a
	 * leftover Keychain value.
	 */
	async #ghSettings(): Promise<Result<GhCallSettings>> {
		const setting = this.#deps.setting;
		const explicit = setting === undefined ? null : setting<string>("gh_auth_method");
		if (explicit === "cli") return ok({ authMethod: "cli", env: undefined });
		const token = await this.#readToken();
		if (!token.ok) return err(token.error);
		const authMethod = resolveGhAuthMethod(explicit, token.value !== null);
		const inject = authMethod === "pat" ? token.value : null;
		return ok({
			authMethod,
			env: inject === null ? undefined : { GH_TOKEN: inject },
		});
	}

	async #authMethod(): Promise<GithubAuthMethod> {
		const settings = await this.#ghSettings();
		return settings.ok ? settings.value.authMethod : "cli";
	}

	/**
	 * Polls one workspace's pull request until the returned function is called. Every role watching
	 * the workspace shares one timer; the smallest requested interval wins. The caller stops the
	 * subscription when the user leaves the workspace or it is archived.
	 */
	watch(workspaceId: WorkspaceId, role: PollRole): Unsubscribe {
		const key = String(workspaceId);
		const existing = this.#pollWatchers.get(key);
		const watcher: PollWatcher = existing ?? {
			roles: new Map<PollRole, number>(),
			stopped: false,
			timer: null,
		};
		watcher.roles.set(role, (watcher.roles.get(role) ?? 0) + 1);
		if (existing === undefined) {
			this.#pollWatchers.set(key, watcher);
			void this.#pollTick(workspaceId, watcher);
		}
		return () => this.#stopWatching(key, role);
	}

	/** Stops every watcher and clears the per-workspace poll state. */
	dispose(): void {
		for (const [key, watcher] of this.#pollWatchers) {
			watcher.stopped = true;
			if (watcher.timer !== null) clearTimeout(watcher.timer);
			this.#pollLatest.invalidate(key);
		}
		this.#pollWatchers.clear();
		this.#noPrUntil.clear();
		this.#lastPolledAt.clear();
		this.#headByWorkspace.clear();
		this.#repoKeyByWorkspace.clear();
		this.#stackMembers.clear();
	}

	/**
	 * Shows pull request info cached before the last restart until the first poll answers
	 * (DATA-07). A workspace that already has an entry keeps it, so a poll that answered first wins.
	 */
	paintCached(workspaceId: WorkspaceId, entry: WorkspacePrEntry): void {
		const key = String(workspaceId);
		if (this.store.getState().byWorkspace[key] !== undefined) return;
		this.#writeEntry(key, entry);
	}

	/** Polls one workspace once. A newer poll's answer wins if two overlap. */
	async pollNow(workspaceId: WorkspaceId): Promise<Result<void>> {
		const key = String(workspaceId);
		const now = this.#deps.now();
		const ticket = this.#pollLatest.begin(key);
		const prepared = await this.#preparePollTarget(workspaceId, now);
		switch (prepared.kind) {
			case "skip":
				this.#pollLatest.settle(ticket);
				return ok(undefined);
			case "settled":
				this.#settleEntry(workspaceId, ticket, prepared.entry, now);
				return ok(undefined);
			case "error":
				return this.#settleFailure(workspaceId, ticket, prepared.error, now);
			case "target": {
				const results = await this.#runTargets([prepared.target]);
				const result =
					results.get(key) ??
					err(appError("github_bad_answer", "GitHub did not answer for that workspace."));
				return this.#settleTargetResult(workspaceId, ticket, result, now);
			}
		}
	}

	#stopWatching(key: string, role: PollRole): void {
		const watcher = this.#pollWatchers.get(key);
		if (watcher === undefined) return;
		const count = (watcher.roles.get(role) ?? 0) - 1;
		if (count > 0) watcher.roles.set(role, count);
		else watcher.roles.delete(role);
		if (watcher.roles.size > 0) return;
		watcher.stopped = true;
		if (watcher.timer !== null) clearTimeout(watcher.timer);
		this.#pollWatchers.delete(key);
		this.#pollLatest.invalidate(key);
		this.#noPrUntil.delete(key);
		this.#lastPolledAt.delete(key);
		this.#headByWorkspace.delete(key);
		this.#repoKeyByWorkspace.delete(key);
		this.#failedCatchUps.delete(key);
		this.#reportedCatchUps.delete(key);
	}

	#subscriptionsOf(watcher: PollWatcher, key: string): PollSubscription[] {
		const pr = this.store.getState().byWorkspace[key]?.pullRequest ?? null;
		return [...watcher.roles].map(([role]) => ({
			role,
			intervalMs: requestedInterval(
				role,
				pr === null
					? null
					: {
							mergeStateStatus: pr.mergeable === "unknown" ? "UNKNOWN" : null,
							merged: pr.state === "merged",
						},
			),
		}));
	}

	async #pollTick(workspaceId: WorkspaceId, watcher: PollWatcher): Promise<void> {
		if (watcher.stopped) return;
		const key = String(workspaceId);
		const subscriptions = this.#subscriptionsOf(watcher, key);
		let intervalMs = requestedInterval("sidebar", null);
		try {
			const decision = await this.#rateGate.decide(subscriptions);
			if (!decision.ok) {
				this.#recordPollFailure(workspaceId, decision.error);
				return;
			}
			intervalMs = decision.value.intervalMs;
			if (
				decision.value.poll &&
				this.#deps.now() - (this.#lastPolledAt.get(key) ?? 0) >= decision.value.intervalMs
			) {
				await this.#pollWatched(workspaceId, decision.value.requestedOnly);
				// Polling is where a stack branch's rewrite is noticed; catch it up on its own, unless
				// the workspace stopped being watched (closed or archived) while the poll ran.
				if (!watcher.stopped) await this.#catchUpAfterPoll(workspaceId, () => watcher.stopped);
			}
		} catch (cause) {
			this.#recordPollFailure(workspaceId, pollCrashError(cause));
		} finally {
			if (!watcher.stopped) {
				watcher.timer = setTimeout(() => {
					void this.#pollTick(workspaceId, watcher);
				}, intervalMs);
			}
		}
	}

	/**
	 * Polls the triggering workspace, and its watched siblings of the same repository unless the
	 * gate asked for the requested workspace alone. One `gh api graphql` call serves a whole batch.
	 * A repository already being polled is left to that poll, so two sibling timers firing together
	 * do not ask GitHub twice.
	 */
	async #pollWatched(workspaceId: WorkspaceId, requestedOnly: boolean): Promise<void> {
		const triggerContext = await this.#deps.contextOf(workspaceId);
		if (!triggerContext.ok) return;
		const triggerRepo = await this.#repoKey(triggerContext.value);
		if (!triggerRepo.ok) {
			this.#recordPollFailure(workspaceId, triggerRepo.error);
			return;
		}
		if (this.#pollingRepos.has(triggerRepo.value)) return;
		this.#pollingRepos.add(triggerRepo.value);
		try {
			await this.#pollRepository(workspaceId, requestedOnly, triggerRepo.value);
		} finally {
			this.#pollingRepos.delete(triggerRepo.value);
		}
	}

	async #pollRepository(
		workspaceId: WorkspaceId,
		requestedOnly: boolean,
		repoKey: string,
	): Promise<void> {
		const now = this.#deps.now();
		const ids: WorkspaceId[] = [workspaceId];
		if (!requestedOnly) {
			for (const otherKey of this.#pollWatchers.keys()) {
				if (otherKey === String(workspaceId)) continue;
				const otherId = otherKey as WorkspaceId;
				const context = await this.#deps.contextOf(otherId);
				if (!context.ok) continue;
				const repo = await this.#repoKey(context.value);
				if (!repo.ok || repo.value !== repoKey) continue;
				ids.push(otherId);
			}
		}

		const tickets = new Map<string, LatestTicket>();
		for (const id of ids) tickets.set(String(id), this.#pollLatest.begin(String(id)));
		const targets: PollTarget[] = [];
		for (const id of ids) {
			const ticket = tickets.get(String(id));
			if (ticket === undefined) continue;
			const prepared = await this.#preparePollTarget(id, now);
			switch (prepared.kind) {
				case "skip":
					this.#pollLatest.settle(ticket);
					break;
				case "settled":
					this.#settleEntry(id, ticket, prepared.entry, now);
					break;
				case "error":
					this.#settleFailure(id, ticket, prepared.error, now);
					break;
				case "target":
					targets.push(prepared.target);
					break;
			}
		}
		if (targets.length === 0) return;
		const results = await this.#runTargets(targets);
		for (const target of targets) {
			const ticket = tickets.get(target.key);
			if (ticket === undefined) continue;
			const result =
				results.get(target.key) ??
				err(appError("github_bad_answer", "GitHub did not answer for that workspace."));
			this.#settleTargetResult(target.workspaceId, ticket, result, now);
		}
	}

	/** Decides whether a workspace may poll, and builds its lookup when it may. */
	async #preparePollTarget(workspaceId: WorkspaceId, now: number): Promise<PollPreparation> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return { kind: "skip" };
		const found = context.value;
		const key = String(workspaceId);

		const remoteUrl = await this.#deps.git.stdout(remoteGetUrl(found.remote), {
			cwd: found.workspacePath,
		});
		if (!remoteUrl.ok && remoteUrl.error.code !== "git_failed") {
			return { kind: "error", error: remoteUrl.error };
		}
		const skip = pollSkipReason({
			active: true,
			repoLinked: true,
			hasRemote: remoteUrl.ok && remoteUrl.value.trim().length > 0,
			offline: this.#githubIsOffline(),
		});
		// Offline before the first answer: say so, or the header would wait for it forever. A
		// workspace that has an entry keeps it, so its pull request stays on screen.
		if (skip === "offline" && this.store.getState().byWorkspace[key] === undefined) {
			return {
				kind: "settled",
				entry: { pullRequest: null, unavailable: "offline", fetchedAt: now },
			};
		}
		if (skip !== null) return { kind: "skip" };

		const remembered = this.#noPrUntil.get(key);
		if (found.prNumber === null && remembered !== undefined && now < remembered) {
			return {
				kind: "settled",
				entry: { pullRequest: null, unavailable: "no_pr", fetchedAt: now },
			};
		}

		const upstream = await this.#upstreamBranch(found);
		if (!upstream.ok) return { kind: "error", error: upstream.error };
		const headBranch = upstream.value?.branch ?? found.branch;
		const pushRemote = upstream.value?.remote ?? found.remote;
		const pushed = await this.#branchPushed(found.workspacePath, pushRemote, headBranch);
		if (!pushed.ok) return { kind: "error", error: pushed.error };
		if (!shouldQueryPr(pushed.value, found.prNumber)) {
			this.#noPrUntil.set(key, now + NO_PR_MEMORY_MS);
			return {
				kind: "settled",
				entry: { pullRequest: null, unavailable: "no_pr", fetchedAt: now },
			};
		}

		const repoKey = await this.#repoKey(found);
		if (!repoKey.ok) return { kind: "error", error: repoKey.error };
		return {
			kind: "target",
			target: {
				workspaceId,
				key,
				found,
				headBranch,
				prNumber: found.prNumber,
				repoKey: repoKey.value,
				now,
			},
		};
	}

	/** The repository a workspace belongs to: the git dir every sibling worktree shares. */
	async #repoKey(context: PrWorkspaceContext): Promise<Result<string>> {
		const key = String(context.workspaceId);
		const cached = this.#repoKeyByWorkspace.get(key);
		if (cached !== undefined) return ok(cached);
		const common = await this.#deps.git.stdout(revParseGitCommonDir(), {
			cwd: context.workspacePath,
		});
		if (!common.ok) return err(common.error);
		const value = common.value.trim();
		if (value.length === 0) {
			return err(appError("git_parse", "git rev-parse --git-common-dir printed nothing."));
		}
		const resolved = value.startsWith("/") ? value : absolutePath(context.workspacePath, value);
		this.#repoKeyByWorkspace.set(key, resolved);
		return ok(resolved);
	}

	#githubIsOffline(): boolean {
		const { access, health } = this.store.getState();
		return access.status === "offline" || health.reason === "offline";
	}

	/**
	 * Runs one batched query per repository, in chunks of the adaptive batch size. A timeout or a
	 * high `rateLimit.cost` shrinks the next chunk; a normal answer grows it back.
	 */
	async #runTargets(
		targets: readonly PollTarget[],
	): Promise<Map<string, Result<WorkspacePrEntry>>> {
		const results = new Map<string, Result<WorkspacePrEntry>>();
		const settings = await this.#ghSettings();
		if (!settings.ok) {
			for (const target of targets) results.set(target.key, err(settings.error));
			return results;
		}
		const groups = new Map<string, PollTarget[]>();
		for (const target of targets) {
			const group = groups.get(target.repoKey);
			if (group === undefined) groups.set(target.repoKey, [target]);
			else group.push(target);
		}
		for (const group of groups.values()) {
			let index = 0;
			while (index < group.length) {
				const size = effectiveBatchSize(this.#batchSizes);
				const chunk = group.slice(index, index + size);
				index += chunk.length;
				await this.#runChunk(chunk, settings.value, results);
			}
		}
		return results;
	}

	async #runChunk(
		chunk: readonly PollTarget[],
		settings: GhCallSettings,
		results: Map<string, Result<WorkspacePrEntry>>,
	): Promise<void> {
		const first = chunk[0];
		if (first === undefined) return;
		const command = prBatchQuery(
			chunk.map((target) => ({ headBranch: target.headBranch, prNumber: target.prNumber })),
		);
		const response = await this.#deps.git.run(
			command,
			this.#runOptions(settings, first.found.workspacePath),
		);
		if (!response.ok) {
			this.#batchSizes = nextBatchSizes(this.#batchSizes, { kind: "timeout" });
			for (const target of chunk) results.set(target.key, err(response.error));
			return;
		}
		await this.recordGhResult(response.value);
		if (!isSuccessfulExit(command, response.value.exitCode)) {
			const error = failedCommandError(command, response.value);
			this.#batchSizes = nextBatchSizes(this.#batchSizes, { kind: "timeout" });
			for (const target of chunk) results.set(target.key, err(error));
			return;
		}
		const answer = parsePrBatchAnswers(response.value.stdout, chunk.length);
		if (!answer.ok) {
			this.#batchSizes = nextBatchSizes(this.#batchSizes, { kind: "timeout" });
			for (const target of chunk) results.set(target.key, err(answer.error));
			return;
		}
		this.#batchSizes = nextBatchSizes(this.#batchSizes, {
			kind: "success",
			cost: answer.value.cost ?? 1,
		});
		chunk.forEach((target, index) => {
			const node = answer.value.nodes[index] ?? null;
			if (node === null) {
				this.#noPrUntil.set(target.key, target.now + NO_PR_MEMORY_MS);
				results.set(
					target.key,
					ok({ pullRequest: null, unavailable: "no_pr", fetchedAt: target.now }),
				);
				return;
			}
			this.#noPrUntil.delete(target.key);
			results.set(
				target.key,
				this.#toWorkspaceEntry(target.key, target.found, node, answer.value, target.now),
			);
		});
	}

	#writeEntry(key: string, entry: WorkspacePrEntry): void {
		this.store.setState((state) => ({
			byWorkspace: { ...state.byWorkspace, [key]: entry },
		}));
	}

	#settleEntry(
		workspaceId: WorkspaceId,
		ticket: LatestTicket,
		entry: WorkspacePrEntry,
		now: number,
	): void {
		const key = String(workspaceId);
		this.#lastPolledAt.set(key, now);
		const latest = this.#pollLatest.isLatest(ticket);
		this.#pollLatest.settle(ticket);
		if (latest) this.#writeEntry(key, entry);
	}

	#settleFailure(
		workspaceId: WorkspaceId,
		ticket: LatestTicket,
		error: AppError,
		now: number,
	): Result<void> {
		const key = String(workspaceId);
		this.#lastPolledAt.set(key, now);
		const latest = this.#pollLatest.isLatest(ticket);
		this.#pollLatest.settle(ticket);
		if (latest) this.#recordPollFailure(workspaceId, error);
		return err(error);
	}

	#settleTargetResult(
		workspaceId: WorkspaceId,
		ticket: LatestTicket,
		result: Result<WorkspacePrEntry>,
		now: number,
	): Result<void> {
		const key = String(workspaceId);
		this.#lastPolledAt.set(key, now);
		const latest = this.#pollLatest.isLatest(ticket);
		this.#pollLatest.settle(ticket);
		if (!latest) return ok(undefined);
		if (!result.ok) {
			this.#recordPollFailure(workspaceId, result.error);
			return err(result.error);
		}
		const previous = this.store.getState().byWorkspace[key]?.pullRequest ?? null;
		this.#writeEntry(key, result.value);
		// After the write, so the sync this starts reads the pull request the poll just found.
		const next = result.value.pullRequest;
		if (
			next !== null &&
			next.state === "open" &&
			(previous === null || previous.updatedAt !== next.updatedAt)
		) {
			this.#deps.onPullRequestChanged?.(workspaceId);
		}
		return ok(undefined);
	}

	#toWorkspaceEntry(
		key: string,
		found: PrWorkspaceContext,
		node: GraphqlPullRequestNode,
		answer: RepositoryAnswer,
		now: number,
	): Result<WorkspacePrEntry> {
		const raw = rawFromGraphql(node);
		const headBranch = raw.headRefName ?? found.branch;
		const state = pullRequestStateOf(raw.state, raw.isDraft);
		if (!closedPrIsShown(state, found.branch, headBranch)) {
			return ok({ pullRequest: null, unavailable: "no_pr", fetchedAt: now });
		}
		const updatedAt =
			raw.updatedAt === null || raw.updatedAt === undefined ? null : parseTimestamp(raw.updatedAt);
		if (updatedAt === null) {
			return err(
				appError("github_bad_answer", "GitHub did not say when the pull request changed."),
			);
		}
		const previous = this.store.getState().byWorkspace[key]?.pullRequest ?? null;
		const sameHead = previous !== null && this.#headByWorkspace.get(key) === raw.headRefOid;
		const extras: PullRequestExtras = {
			authorLogin: raw.author?.login ?? null,
			viewerCanMerge: answer.viewerCanMerge,
			mergeMethod: answer.mergeMethod,
			reviewers: toReviewers(raw),
			deployments: toDeployments(raw.deployments ?? []),
			updatedAt,
		};
		const pr = toPullRequest(raw, extras, NO_REQUIRED_CHECKS);
		pr.mergeable = reconcileMergeable(previous?.mergeable ?? null, pr.mergeable, sameHead);
		this.#headByWorkspace.set(key, raw.headRefOid);
		if (state === "merged" && previous?.state !== "merged") {
			this.#deps.onMerged(found.workspaceId, raw.number);
		}
		return ok({ pullRequest: pr, unavailable: "none", fetchedAt: now });
	}

	/** The remote and branch as pushed, from the branch's configured upstream. */
	async #upstreamBranch(
		context: PrWorkspaceContext,
	): Promise<Result<{ remote: string; branch: string } | null>> {
		const options = { cwd: context.workspacePath };
		const remote = await this.#deps.git.stdout(
			configGet(`branch.${context.branch}.remote`),
			options,
		);
		if (!remote.ok) return err(remote.error);
		const merge = await this.#deps.git.stdout(configGet(`branch.${context.branch}.merge`), options);
		if (!merge.ok) return err(merge.error);
		const branch = headBranchFromUpstream(remote.value, merge.value);
		return ok(branch === null ? null : { remote: remote.value.trim(), branch });
	}

	async #branchPushed(cwd: string, remote: string, branch: string): Promise<Result<boolean>> {
		if (remote.trim().length === 0 || branch.trim().length === 0) return ok(false);
		const result = await this.#deps.git.stdout(revParseVerify(`refs/remotes/${remote}/${branch}`), {
			cwd,
		});
		if (!result.ok) return err(result.error);
		return ok(result.value.trim().length > 0);
	}

	/**
	 * Reads the GraphQL budget left for the gate. Ok(null) means the host does not rate limit. Any
	 * failure is returned as an error, so the gate pauses polling and reports it; it never invents
	 * a budget.
	 */
	async #readRateLimit(): Promise<Result<number | null>> {
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const command = apiRateLimit();
		const result = await this.#deps.git.run(command, this.#runOptions(settings.value));
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (isSuccessfulExit(command, result.value.exitCode)) {
			return parseGraphqlBudget(result.value.stdout);
		}
		const text = `${result.value.stderr}\n${result.value.stdout}`;
		// GitHub Enterprise without rate limiting answers this way: there is no budget to stop for.
		if (/rate limiting is not enabled/i.test(text)) return ok(null);
		return err(failedCommandError(command, result.value));
	}

	#recordPollFailure(workspaceId: WorkspaceId, error: AppError): void {
		const key = String(workspaceId);
		const previous = this.store.getState().byWorkspace[key];
		const offline =
			error.code === "process_spawn" ||
			error.code === "shell_timeout" ||
			classifyGhFailure(error.message) === "offline";
		const unavailable: WorkspacePrEntry["unavailable"] =
			error.code === "github_not_github" ? "not_github" : offline ? "offline" : "no_github_access";
		this.#writeEntry(key, {
			pullRequest: previous?.pullRequest ?? null,
			unavailable,
			fetchedAt: this.#deps.now(),
		});
	}

	/** Backs `Actions.pullRequests.create`: asks the agent to open the PR, as a draft if asked. */
	async create(workspaceId: WorkspaceId, options: { draft: boolean }): Promise<Result<void>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const target = this.#targetBranchOf(found);
		if (!target.ok) return target;
		const forge = await this.#assertGithubRemote(found);
		if (!forge.ok) return forge;

		const cwd = found.workspacePath;
		const [status, files] = await Promise.all([
			this.#deps.git.stdout(statusPorcelainAll(), { cwd }),
			this.#deps.git.stdout(lsFiles(), { cwd }),
		]);
		if (!status.ok) return err(status.error);
		if (!files.ok) return err(files.error);

		const includeLink = this.#deps.setting?.<boolean>("include_workspace_link_in_pr") ?? false;
		const text = createPrInstruction({
			draft: options.draft,
			remote: found.remote,
			targetBranch: target.value,
			branch: found.branch,
			customPrompt: found.customPrompt ?? null,
			prTemplatePath: findPrTemplate(
				files.value
					.split("\n")
					.map((path) => path.trim())
					.filter((path) => path.length > 0),
			),
			hasUncommittedChanges: status.value.trim().length > 0,
			workspaceLink: includeLink ? buildDeepLink(found.workspaceId, null) : null,
		});
		const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
		return sent.ok ? ok(undefined) : err(sent.error);
	}

	/** Backs `Actions.pullRequests.openOnGithub`: opens GitHub's new-PR page in the browser. */
	async openOnGithub(workspaceId: WorkspaceId): Promise<Result<void>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const target = this.#targetBranchOf(found);
		if (!target.ok) return target;
		const forge = await this.#assertGithubRemote(found);
		if (!forge.ok) return forge;

		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const command = prCreateWeb(target.value, found.branch);
		const result = await this.#deps.git.run(
			command,
			this.#runOptions(settings.value, found.workspacePath),
		);
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (isSuccessfulExit(command, result.value.exitCode)) return ok(undefined);
		const text = `${result.value.stderr}\n${result.value.stdout}`;
		const message = githubFailureMessage(classifyGhFailure(text), text);
		return err(
			message === null
				? failedCommandError(command, result.value)
				: appError("github_failed", message),
		);
	}

	/** The target branch as `gh pr create --base` expects it, parsed by the one target rule. */
	#targetBranchOf(context: PrWorkspaceContext): Result<string> {
		const stored = context.targetBranch?.trim() ?? "";
		if (stored.length === 0) {
			return err(appError("github_target_unknown", "This workspace has no target branch."));
		}
		return parseTargetBranch(context.remote, stored);
	}

	/** Refuses to act on a repository without a GitHub remote. */
	async #assertGithubRemote(context: PrWorkspaceContext): Promise<Result<void>> {
		if (context.remote.trim().length === 0) {
			return err(appError("github_not_github", "This repository has no GitHub remote."));
		}
		const url = await this.#deps.git.stdout(remoteGetUrl(context.remote), {
			cwd: context.workspacePath,
		});
		if (!url.ok) return err(url.error);
		return forgeForRemoteUrl(url.value) === "github"
			? ok(undefined)
			: err(appError("github_not_github", "This repository has no GitHub remote."));
	}

	/**
	 * Backs `Actions.pullRequests.fixErrors`: sends failing checks and log tails to the agent. The
	 * logs are read a few at a time, so many failing jobs do not wait for each other in a row.
	 */
	fixErrors(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#flights.run(`fixErrors:${workspaceId}`, async () => {
			const pullRequest = this.store.getState().byWorkspace[String(workspaceId)]?.pullRequest;
			const failingChecks = (pullRequest?.checks ?? []).filter(
				(check) => check.state === "failure",
			);
			if (failingChecks.length === 0) {
				return err(appError("github_no_failed_checks", "No failing checks to fix."));
			}

			const context = await this.#deps.contextOf(workspaceId);
			if (!context.ok) return err(context.error);
			const found = context.value;
			const promptFor = this.#deps.fixErrorsPromptOf;
			if (promptFor === undefined) {
				return err(
					appError("github_context_unavailable", "The repository settings are not available."),
				);
			}
			const customPrompt = await promptFor(workspaceId);
			if (!customPrompt.ok) return err(customPrompt.error);

			const custom = customPrompt.value?.trim() ?? "";
			// A repository prompt replaces the whole instruction, so its logs are not read.
			const failing =
				custom.length > 0
					? failingChecks.map((check) => ({ check, logTail: null, logError: null }))
					: await mapInBatches(failingChecks, FIX_ERRORS_LOG_READS, (check) =>
							this.#checkLogTail(workspaceId, check),
						);

			const text = fixErrorsInstruction({
				branch: found.branch,
				customPrompt: customPrompt.value,
				failing,
			});
			const sent = await this.#deps.agent.sendInstruction(workspaceId, text);
			return sent.ok ? ok(undefined) : err(sent.error);
		});
	}

	/**
	 * A failing check with the last lines of its log, as plain text. A check that is not a
	 * workflow job has no log. A log that could not be read keeps its reason, so the message tells
	 * the agent and the user why it is missing; the check is still sent.
	 */
	async #checkLogTail(workspaceId: WorkspaceId, check: CheckRun): Promise<FailingCheck> {
		if (parseCheckJob(check.url) === null) return { check, logTail: null, logError: null };
		const log = await this.readCheckLog(workspaceId, check.url);
		return log.ok
			? { check, logTail: fixErrorsLogTail(log.value), logError: null }
			: { check, logTail: null, logError: log.error.message };
	}

	/**
	 * Backs `Actions.pullRequests.rerunFailedChecks`: `gh run rerun <run> --failed` in the
	 * workspace, once for each workflow run that has a failed check, with the run id read from the
	 * check's details URL (services-map 3.7.5). Two failed jobs of one run send one command. The
	 * checks come from the pull request the panel shows; afterwards the PR is read once again so
	 * the re-run checks show as queued.
	 */
	rerunFailedChecks(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#flights.run(`rerunFailedChecks:${workspaceId}`, async () => {
			const pullRequest = this.store.getState().byWorkspace[String(workspaceId)]?.pullRequest;
			const runIds = new Set<string>();
			for (const check of pullRequest?.checks ?? []) {
				if (check.state !== "failure") continue;
				const job = parseCheckJob(check.url);
				if (job !== null) runIds.add(job.runId);
			}
			if (runIds.size === 0) {
				return err(appError("github_no_failed_runs", "No failed GitHub Actions run to re-run."));
			}
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, runOptions } = prepared.value;
			for (const runId of runIds) {
				const command: GitCommand = {
					program: "gh",
					args: ["run", "rerun", runId, "--failed"],
					retryOnLock: false,
				};
				const ran = await this.#runPullRequestCommand(found, runOptions, command);
				if (!ran.ok) return ran;
			}
			// A failed refresh is kept on the workspace's PR entry, where the panel shows it.
			await this.#refreshAfterWrite(workspaceId);
			return ok(undefined);
		});
	}

	/**
	 * The number of the workspace's pull request: the one linked to the workspace, else the one the
	 * poll found for its branch. An agent opens most pull requests, so the poll's answer is the only
	 * place their number lives (Conductor reads `workspacePrInfo`, services-map.md 2426).
	 */
	#pullRequestNumberOf(found: PrWorkspaceContext): number | null {
		return (
			found.prNumber ??
			this.store.getState().byWorkspace[String(found.workspaceId)]?.pullRequest?.number ??
			null
		);
	}

	/** Reads the workspace's pull request and the `gh` sign-in every write action needs. */
	async #preparePullRequestWrite(workspaceId: WorkspaceId): Promise<
		Result<{
			found: PrWorkspaceContext;
			prNumber: number;
			runOptions: GitRunOptions;
		}>
	> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const prNumber = this.#pullRequestNumberOf(found);
		if (prNumber === null) {
			return err(appError("github_pr_missing", "This workspace has no pull request yet."));
		}
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		return ok({
			found,
			prNumber,
			runOptions: this.#runOptions(settings.value, found.workspacePath),
		});
	}

	/**
	 * The log of one check job, the last 1000 lines. Reads the job id from the check's details URL;
	 * a check that is not a workflow job (an external status context) has no log.
	 */
	async readCheckLog(workspaceId: WorkspaceId, detailsUrl: string | null): Promise<Result<string>> {
		const job = parseCheckJob(detailsUrl);
		if (job === null) {
			return err(appError("github_check_no_job", "No logs available."));
		}
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const runOptions = this.#runOptions(settings.value, context.value.workspacePath);

		// `--allow-escape-sequences` keeps the log's colours. An older gh does not know the flag,
		// so the same call is retried without it.
		const read = async (
			allowEscape: boolean,
		): Promise<Result<{ output: ShellOutput; ok: boolean }>> => {
			const command: GitCommand = {
				program: "gh",
				args: [
					"api",
					`repos/{owner}/{repo}/actions/jobs/${job.jobId}/logs`,
					...(allowEscape ? ["--allow-escape-sequences"] : []),
				],
				retryOnLock: false,
			};
			const result = await this.#deps.git.run(command, runOptions);
			if (!result.ok) return err(result.error);
			await this.recordGhResult(result.value);
			return ok({ output: result.value, ok: isSuccessfulExit(command, result.value.exitCode) });
		};

		let answer = await read(true);
		if (!answer.ok) return err(answer.error);
		const text = `${answer.value.output.stderr}\n${answer.value.output.stdout}`;
		if (!answer.value.ok && /unknown flag: --allow-escape-sequences/i.test(text)) {
			answer = await read(false);
			if (!answer.ok) return err(answer.error);
		}
		if (!answer.value.ok) {
			const failure = `${answer.value.output.stderr}\n${answer.value.output.stdout}`;
			// GitHub answers 404 or 410 for a job whose logs were never kept or have expired.
			if (/HTTP (404|410)\b/.test(failure)) {
				return err(
					appError("github_check_log_expired", "No logs were recorded, or they have expired."),
				);
			}
			return err(appError("github_check_log_failed", "Couldn't load the logs."));
		}
		return ok(checkLogTail(answer.value.output.stdout));
	}

	/** The error a failed write action means, with the blocked message for a moved head. */
	#writeError(command: GitCommand, output: ShellOutput): AppError {
		const text = `${output.stderr}\n${output.stdout}`;
		if (isHeadMismatchFailure(text)) {
			return appError("github_head_mismatch", GITHUB_HEAD_MISMATCH_MESSAGE);
		}
		return ghCommandError(command, output);
	}

	/**
	 * Runs one `gh` command of a pull request action, records its health answer, and maps a failed
	 * exit to the write error. Every write and the reads they depend on go through here.
	 */
	async #runGh(command: GitCommand, runOptions: GitRunOptions): Promise<Result<ShellOutput>> {
		const result = await this.#deps.git.run(command, runOptions);
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (!isSuccessfulExit(command, result.value.exitCode)) {
			return err(this.#writeError(command, result.value));
		}
		return ok(result.value);
	}

	/** One value a `gh --jq` read prints, without the quotes JSON puts around a string. */
	async #ghScalar(command: GitCommand, runOptions: GitRunOptions): Promise<Result<string>> {
		const run = await this.#runGh(command, runOptions);
		if (!run.ok) return err(run.error);
		return ok(run.value.stdout.trim().replace(/^"|"$/g, ""));
	}

	/** Runs one pull request write command through `#runGh`, holding the worktree lock if asked. */
	async #runPullRequestCommand(
		found: PrWorkspaceContext,
		runOptions: GitRunOptions,
		command: GitCommand,
		lockWorktree = false,
	): Promise<Result<void>> {
		const run = async (): Promise<Result<void>> => {
			const result = await this.#runGh(command, runOptions);
			return result.ok ? ok(undefined) : err(result.error);
		};
		return lockWorktree ? this.#deps.git.withWorktreeLock(found.workspacePath, run) : run();
	}

	/** The local HEAD and the repository's merge method, the two pins every merge needs. */
	async #mergeSetup(
		found: PrWorkspaceContext,
		runOptions: GitRunOptions,
	): Promise<Result<{ head: string; method: MergeMethod }>> {
		const head = await this.#deps.git.stdout(revParseHead(), { cwd: found.workspacePath });
		if (!head.ok) return err(head.error);
		const headCommit = head.value.trim();
		if (headCommit.length === 0) {
			return err(
				appError("github_head_unknown", "Merge blocked: can't read the workspace's HEAD commit."),
			);
		}
		const method = await this.#mergeMethodFor(found, runOptions);
		if (!method.ok) return err(method.error);
		return ok({ head: headCommit, method: method.value });
	}

	/** The repository's merge method, read from GitHub once and kept for later merges. */
	async #mergeMethodFor(
		found: PrWorkspaceContext,
		runOptions: GitRunOptions,
	): Promise<Result<MergeMethod>> {
		const repoKey = await this.#repoKey(found);
		if (!repoKey.ok) return err(repoKey.error);
		const cached = this.#mergeMethodByRepo.get(repoKey.value);
		if (cached !== undefined) return ok(cached);

		const allowed = await this.#runGh(repoMergeMethodsQuery(), runOptions);
		if (!allowed.ok) return err(allowed.error);
		const method = chooseMergeMethod(allowed.value.stdout.trim());
		if (method === null) {
			return err(
				appError(
					"github_merge_not_allowed",
					"This repository doesn't allow merging pull requests.",
				),
			);
		}
		this.#mergeMethodByRepo.set(repoKey.value, method);
		return ok(method);
	}

	/** The pull request's head commit, so an approval names exactly what GitHub is showing. */
	async #pullRequestHead(runOptions: GitRunOptions, prNumber: number): Promise<Result<string>> {
		const head = await this.#ghScalar(prViewHeadCommit(prNumber), runOptions);
		if (!head.ok) return err(head.error);
		const oid = head.value;
		if (oid.length === 0) {
			return err(
				appError("github_head_unknown", "GitHub did not report the pull request's head commit."),
			);
		}
		return ok(oid);
	}

	/**
	 * Backs `Actions.pullRequests.markReady`: `gh pr ready` (services-map 3.7.5). The stack view
	 * passes the number of the entry it shows, which may be another pull request of the stack than
	 * the workspace's own (PR-08). Each pull request runs one mark at a time.
	 */
	markReady(workspaceId: WorkspaceId, prNumber?: number): Promise<Result<void>> {
		const key = prNumber === undefined ? "markReady" : `markReady#${prNumber}`;
		return this.#writeAction(key, "marking_ready", workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, runOptions } = prepared.value;
			return this.#runPullRequestCommand(
				found,
				runOptions,
				prReady(prNumber ?? prepared.value.prNumber),
			);
		});
	}

	/**
	 * Backs `Actions.pullRequests.merge`: the merge is pinned to the workspace's HEAD and uses the
	 * repository's method. A moved head is refused with the blocked message, not merged silently.
	 */
	merge(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#writeAction("merge", "merging", workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, prNumber, runOptions } = prepared.value;
			const setup = await this.#mergeSetup(found, runOptions);
			if (!setup.ok) return err(setup.error);
			const command = prMerge(prNumber, setup.value.method, setup.value.head, false);
			return this.#runPullRequestCommand(found, runOptions, command, true);
		});
	}

	/**
	 * Backs `Actions.pullRequests.setAutoMerge`: turning it on is the same pinned merge with
	 * `--auto`; turning it off sends `--disable-auto` (services-map 3.7.5).
	 */
	setAutoMerge(workspaceId: WorkspaceId, enabled: boolean): Promise<Result<void>> {
		const key = enabled ? "enableAutoMerge" : "disableAutoMerge";
		const action = enabled ? "enabling_auto_merge" : "disabling_auto_merge";
		return this.#writeAction(key, action, workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, prNumber, runOptions } = prepared.value;
			if (!enabled) {
				return this.#runPullRequestCommand(found, runOptions, prMergeDisableAuto(prNumber));
			}
			const setup = await this.#mergeSetup(found, runOptions);
			if (!setup.ok) return err(setup.error);
			const command = prMerge(prNumber, setup.value.method, setup.value.head, true);
			return this.#runPullRequestCommand(found, runOptions, command, true);
		});
	}

	/** Backs `Actions.pullRequests.approve`: the approval is pinned to the pull request's head. */
	approve(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#writeAction("approve", "approving", workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, prNumber, runOptions } = prepared.value;
			const head = await this.#pullRequestHead(runOptions, prNumber);
			if (!head.ok) return err(head.error);
			return this.#runPullRequestCommand(found, runOptions, prApprove(prNumber, head.value));
		});
	}

	/** Backs `Actions.pullRequests.updateTitleAndBody`: one `gh pr edit` carries both fields. */
	updateTitleAndBody(workspaceId: WorkspaceId, title: string, body: string): Promise<Result<void>> {
		return this.#writeAction("updateTitleAndBody", "updating", workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, prNumber, runOptions } = prepared.value;
			return this.#runPullRequestCommand(found, runOptions, prEdit(prNumber, { title, body }));
		});
	}

	/**
	 * GIT-08: moves the base of the workspace's open pull request. Returns false when there is no
	 * open pull request, so the caller can fall back to the local fetch and reset.
	 */
	async moveOpenPullRequestBase(
		workspaceId: WorkspaceId,
		branch: string,
	): Promise<Result<boolean>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const prNumber = this.#pullRequestNumberOf(found);
		if (prNumber === null) return ok(false);

		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const runOptions = this.#runOptions(settings.value, found.workspacePath);

		const state = await this.#ghScalar(prViewState(prNumber), runOptions);
		if (!state.ok) return err(state.error);
		if (state.value !== "OPEN") return ok(false);

		const edited = await this.#runPullRequestCommand(
			found,
			runOptions,
			prEdit(prNumber, { base: branch }),
		);
		return edited.ok ? ok(true) : err(edited.error);
	}

	/**
	 * Backs `Actions.pullRequests.mergeStack`: `gh stack merge` for the workspace's pull request
	 * (services-map 3.8.2). The merge method is the repository's first allowed one, as with a single
	 * merge. Stacked pull requests switched off are refused, so the action follows the setting.
	 */
	mergeStack(workspaceId: WorkspaceId): Promise<Result<void>> {
		const setting = this.#deps.setting;
		if (setting !== undefined && setting<boolean>("github_stacked_prs_enabled") !== true) {
			return Promise.resolve(
				err(
					appError("github_stacks_disabled", "Stacked pull requests are turned off in Settings."),
				),
			);
		}
		return this.#writeAction("mergeStack", "merging", workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, prNumber, runOptions } = prepared.value;
			const method = await this.#mergeMethodFor(found, runOptions);
			if (!method.ok) return err(method.error);
			return this.#deps.git.withWorktreeLock(found.workspacePath, async () => {
				const merged = await this.#runStackCommand(
					stackMerge(prNumber, method.value),
					runOptions,
					"Merging",
				);
				return merged.ok ? ok(undefined) : err(merged.error);
			});
		});
	}

	/**
	 * Runs one `gh stack` command and records its health answer. A command `gh` does not know means
	 * the stack extension is missing, which gets the install message for this action instead of the
	 * raw `gh` error. Any other failed exit is the write error.
	 */
	async #runStackCommand(
		command: GitCommand,
		runOptions: GitRunOptions,
		action: StackAction,
	): Promise<Result<{ text: string }>> {
		const result = await this.#deps.git.run(command, runOptions);
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		const text = `${result.value.stderr}\n${result.value.stdout}`;
		if (isStackExtensionMissing(text)) {
			return err(appError("github_stack_extension_missing", stackExtensionMessage(action)));
		}
		if (!isSuccessfulExit(command, result.value.exitCode)) {
			return err(this.#writeError(command, result.value));
		}
		return ok({ text });
	}

	/**
	 * Backs `Actions.pullRequests.syncStack`. Runs `gh stack sync` for a stacked branch
	 * (services-map 3.8.2) under the worktree lock and then the repo lock (3.0.3). A command that
	 * `gh` does not know means the stack extension is missing; a cross mark or "Sync aborted" means
	 * the sync stopped partway. Both are errors, so a partial sync is never reported as done.
	 */
	syncStack(workspaceId: WorkspaceId): Promise<Result<void>> {
		const setting = this.#deps.setting;
		if (setting !== undefined && setting<boolean>("github_stacked_prs_enabled") !== true) {
			return Promise.resolve(
				err(
					appError("github_stacks_disabled", "Stacked pull requests are turned off in Settings."),
				),
			);
		}
		return this.#writeAction("syncStack", "syncing_stack", workspaceId, async () => {
			const context = await this.#deps.contextOf(workspaceId);
			if (!context.ok) return err(context.error);
			const { workspacePath, repoRootPath } = context.value;
			if (repoRootPath === undefined) {
				return err(
					appError(
						"github_repo_root_unknown",
						"The stack sync needs the repository's main folder, which is not known.",
					),
				);
			}
			const settings = await this.#ghSettings();
			if (!settings.ok) return err(settings.error);
			const runOptions = this.#runOptions(settings.value, workspacePath);
			// The sync rewrites the workspace branch and the branch config of the whole repository.
			return this.#deps.git.withWorktreeAndRepoLocks(workspacePath, repoRootPath, async () => {
				const synced = await this.#runStackCommand(stackSync(), runOptions, "Syncing");
				if (!synced.ok) return err(synced.error);
				if (hasStackSyncAbort(synced.value.text)) {
					return err(
						appError(
							"github_stack_sync_aborted",
							"The stack sync stopped before it finished. Nothing was reported as done.",
						),
					);
				}
				return ok(undefined);
			});
		});
	}

	/**
	 * Reads the GitHub stack the workspace's pull request belongs to, from trunk up, with each
	 * member's commit ids and merge state (services-map 3.8.2). A pull request outside a stack, or
	 * stacks turned off in Settings, is an empty answer, not an error. The optional `stackEntry`
	 * field is retried without when the host does not know it, and that host is remembered.
	 */
	async readStack(workspaceId: WorkspaceId): Promise<Result<StackEntryView[]>> {
		const key = String(workspaceId);
		const setting = this.#deps.setting;
		if (setting !== undefined && setting<boolean>("github_stacked_prs_enabled") !== true) {
			this.#stackMembers.delete(key);
			return ok([]);
		}
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const prNumber = this.#pullRequestNumberOf(found);
		if (prNumber === null) {
			this.#stackMembers.delete(key);
			return ok([]);
		}

		const remote = await this.#remoteOf(found);
		if (!remote.ok) return err(remote.error);
		// A host that refused the field once is asked without it from then on, for every repository.
		const host = remote.value.host;
		const includeStackEntry = !this.#stackEntryUnsupported.has(host);

		const readDetails = (withField: boolean) =>
			this.#readGh(prStackQuery(prNumber, withField), found.workspacePath);
		let details = await readDetails(includeStackEntry);
		if (includeStackEntry && !details.ok && isUndefinedStackFieldError(details.error.message)) {
			this.#stackEntryUnsupported.add(host);
			details = await readDetails(false);
		}
		if (!details.ok) return err(details.error);
		const parsedStack = parsePrStackEntry(details.value);
		if (!parsedStack.ok) return err(parsedStack.error);
		if (parsedStack.value === null) {
			this.#stackMembers.delete(key);
			return ok([]);
		}

		const members = await this.#readGh(stackMembers(parsedStack.value.number), found.workspacePath);
		if (!members.ok) return err(members.error);
		const parsedMembers = parseStackMembers(members.value);
		if (!parsedMembers.ok) return err(parsedMembers.error);
		const readiness = await this.#readStackReadiness(
			parsedMembers.value.map((member) => member.number),
			found.workspacePath,
		);
		this.#stackMembers.set(key, parsedMembers.value);
		const repoRootPath = found.repoRootPath ?? found.workspacePath;
		return ok(
			parsedMembers.value.map(({ baseBranch: _baseBranch, ...member }) => ({
				...member,
				isCurrent: member.branch === found.branch,
				needsRestack: this.#deps.graphite?.needsRestackOf(repoRootPath, member.branch) ?? false,
				mergeStateStatus: readiness.get(member.number) ?? null,
			})),
		);
	}

	/**
	 * The members of the workspace's stack for the range diff scope (PR-08): the ones the last
	 * stack read found, so a range listed every few seconds does not ask GitHub each time. The stack
	 * view reads the stack every minute; when nothing has read it yet, this reads it.
	 */
	async stackMembersOf(workspaceId: WorkspaceId): Promise<Result<readonly StackMember[]>> {
		const key = String(workspaceId);
		const known = this.#stackMembers.get(key);
		if (known !== undefined) return ok(known);
		const read = await this.readStack(workspaceId);
		if (!read.ok) return read;
		return ok(this.#stackMembers.get(key) ?? []);
	}

	/**
	 * GitHub's merge state of each stack member, in one query (services-map 3.8.2). A failed read
	 * or an answer the app cannot parse leaves every entry's readiness unknown and keeps the stack:
	 * the readiness rules treat unknown as "not known yet", so the stack view still shows, with
	 * no verdict, as Conductor does.
	 */
	async #readStackReadiness(
		prNumbers: readonly number[],
		cwd: string,
	): Promise<Map<number, MergeStateStatus>> {
		if (prNumbers.length === 0) return new Map();
		const answer = await this.#readGh(stackReadinessQuery(prNumbers), cwd);
		if (!answer.ok) return new Map();
		const parsed = parseStackReadiness(answer.value);
		return parsed.ok ? parsed.value : new Map();
	}

	/**
	 * Reads every review thread of the workspace's pull request, following both the thread pages
	 * and each thread's comment pages (REV-04, services-map 3.7.4). A repository without a GitHub
	 * remote, or a workspace without a pull request, is refused with its own code so the caller can
	 * treat it as a normal skip.
	 */
	async readReviewThreads(workspaceId: WorkspaceId): Promise<Result<GithubReviewThread[]>> {
		const target = await this.#reviewSyncTarget(workspaceId);
		if (!target.ok) return err(target.error);
		const { prNumber, workspacePath } = target.value;
		const threads: GithubReviewThread[] = [];
		let cursor: string | null = null;
		do {
			const page = await this.#readGh(reviewThreadsQuery(prNumber, cursor), workspacePath);
			if (!page.ok) return err(page.error);
			const parsed = parseReviewThreadsAnswer(page.value);
			if (!parsed.ok) return err(parsed.error);
			for (const thread of parsed.value.threads) {
				const comments = [...thread.comments];
				let commentCursor = thread.commentsHasNextPage ? thread.commentsEndCursor : null;
				if (thread.commentsHasNextPage && commentCursor === null) {
					return err(
						appError("github_bad_answer", "GitHub did not say where its comment page ends."),
					);
				}
				while (commentCursor !== null) {
					const rest = await this.#readGh(
						reviewThreadCommentsQuery(thread.id, commentCursor),
						workspacePath,
					);
					if (!rest.ok) return err(rest.error);
					const restPage = parseReviewThreadCommentsAnswer(rest.value);
					if (!restPage.ok) return err(restPage.error);
					comments.push(...restPage.value.comments);
					commentCursor = restPage.value.hasNextPage ? restPage.value.endCursor : null;
					if (restPage.value.hasNextPage && commentCursor === null) {
						return err(
							appError("github_bad_answer", "GitHub did not say where its comment page ends."),
						);
					}
				}
				threads.push({ ...thread, comments });
			}
			const next = parsed.value.hasNextPage ? parsed.value.endCursor : null;
			if (parsed.value.hasNextPage && next === null) {
				return err(appError("github_bad_answer", "GitHub did not say where its thread page ends."));
			}
			cursor = next;
		} while (cursor !== null);
		return ok(threads);
	}

	/** Reads every conversation comment on the pull request itself, following its pages (REV-04). */
	async readGeneralComments(workspaceId: WorkspaceId): Promise<Result<GithubGeneralComment[]>> {
		const target = await this.#reviewSyncTarget(workspaceId);
		if (!target.ok) return err(target.error);
		const { prNumber, workspacePath } = target.value;
		const comments: GithubGeneralComment[] = [];
		let cursor: string | null = null;
		do {
			const page = await this.#readGh(generalCommentsQuery(prNumber, cursor), workspacePath);
			if (!page.ok) return err(page.error);
			const parsed = parseGeneralCommentsAnswer(page.value);
			if (!parsed.ok) return err(parsed.error);
			comments.push(...parsed.value.comments);
			const next = parsed.value.hasNextPage ? parsed.value.endCursor : null;
			if (parsed.value.hasNextPage && next === null) {
				return err(
					appError("github_bad_answer", "GitHub did not say where its comment page ends."),
				);
			}
			cursor = next;
		} while (cursor !== null);
		return ok(comments);
	}

	/** Resolves one review thread on GitHub (REV-04, services-map 3.7.4). */
	async resolveReviewThread(workspaceId: WorkspaceId, threadId: string): Promise<Result<void>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const result = await this.#readGh(
			resolveReviewThreadCommand(threadId),
			context.value.workspacePath,
		);
		return result.ok ? ok(undefined) : err(result.error);
	}

	/** The PR number and folder a review-comment sync reads, after checking the remote is GitHub. */
	async #reviewSyncTarget(
		workspaceId: WorkspaceId,
	): Promise<Result<{ prNumber: number; workspacePath: string }>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const prNumber = this.#pullRequestNumberOf(found);
		if (prNumber === null) {
			return err(appError("github_pr_missing", "This workspace has no pull request yet."));
		}
		const remoteUrl = await this.#deps.git.stdout(remoteGetUrl(found.remote), {
			cwd: found.workspacePath,
		});
		if (!remoteUrl.ok) return err(remoteUrl.error);
		const repository = githubRepositoryFromRemote(remoteUrl.value);
		if (!repository.ok) return err(repository.error);
		return ok({ prNumber, workspacePath: found.workspacePath });
	}

	/**
	 * Catches a stack branch up with its rewritten upstream (PR-12, services-map 3.8.3). Runs on
	 * its own when polling sees the branch fall behind; skipping is the normal result, see
	 * `CatchUpSkipReason`. The guarded rebase moves the branch onto the rewritten upstream tip,
	 * after the clean-tree, operation, ignored-file and identity checks. It holds the worktree lock
	 * and then the repo lock, as Conductor does. The baseline ref records the new tip, so the next
	 * catch-up knows the branch was here. `stopped` says the workspace is no longer watched; it is
	 * read again after each slow step, so a closed or archived workspace is never rebased.
	 */
	async catchUpStackBranch(
		workspaceId: WorkspaceId,
		stopped: () => boolean,
	): Promise<Result<CatchUpOutcome>> {
		const key = String(workspaceId);
		let tips: string | null = null;
		const result = await this.#catchUp(workspaceId, stopped, (pair) => {
			tips = pair;
		});
		if (!result.ok && tips !== null) this.#failedCatchUps.set(key, tips);
		if (result.ok && result.value.kind === "rebased") this.#failedCatchUps.delete(key);
		return result;
	}

	async #catchUp(
		workspaceId: WorkspaceId,
		stopped: () => boolean,
		onTips: (pair: string) => void,
	): Promise<Result<CatchUpOutcome>> {
		const skip = (reason: CatchUpSkipReason): Result<CatchUpOutcome> =>
			ok({ kind: "skipped", reason });
		const setting = this.#deps.setting;
		if (setting !== undefined && setting<boolean>("github_stacked_prs_enabled") !== true) {
			return skip("not_in_stack");
		}
		// The stack read needs GitHub, so an offline poll does not try to catch anything up.
		if (this.#githubIsOffline()) return skip("not_in_stack");
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const key = String(workspaceId);
		const pullRequest = this.store.getState().byWorkspace[key]?.pullRequest ?? null;
		if (pullRequest === null) return skip("not_in_stack");
		if (pullRequest.state !== "open" && pullRequest.state !== "draft") return skip("not_in_stack");
		if (!pullRequest.viewerCanMerge) return skip("no_write_permission");
		const repoRootPath = found.repoRootPath;
		if (repoRootPath === undefined) {
			return err(
				appError(
					"github_repo_root_unknown",
					"The stack catch-up needs the repository's main folder, which is not known.",
				),
			);
		}
		const cwd = found.workspacePath;

		// Step 2: the branch, its head, its upstream and the remote must agree with the workspace.
		const branchRef = await this.#deps.git.stdout(symbolicRefHead(), { cwd });
		if (!branchRef.ok) return err(branchRef.error);
		if (branchRef.value === "") return skip("detached_head");
		if (branchRef.value !== `refs/heads/${found.branch}`) return skip("identity_changed");
		const head = await this.#deps.git.stdout(revParseHead(), { cwd });
		if (!head.ok) return err(head.error);
		if (head.value === "") {
			return err(appError("git_parse", "git rev-parse HEAD printed nothing."));
		}
		const upstreamRef = await this.#deps.git.stdout(upstreamFullName(), { cwd });
		if (!upstreamRef.ok) return err(upstreamRef.error);
		if (upstreamRef.value === "") return skip("not_diverged");
		const upstream = await this.#deps.git.stdout(revParseVerify(upstreamRef.value), { cwd });
		if (!upstream.ok) return err(upstream.error);
		if (upstream.value === "") return skip("not_diverged");
		const remote = await this.#deps.git.stdout(configGet(`branch.${found.branch}.remote`), {
			cwd,
		});
		if (!remote.ok) return err(remote.error);
		if (remote.value === "" || remote.value !== found.remote) return skip("identity_changed");
		const upstreamPrefix = `refs/remotes/${found.remote}/`;
		const upstreamBranch = upstreamRef.value.startsWith(upstreamPrefix)
			? upstreamRef.value.slice(upstreamPrefix.length)
			: null;
		if (upstreamBranch !== found.branch) return skip("identity_changed");
		if (head.value === upstream.value) return skip("not_diverged");
		const pair = `${head.value}:${upstream.value}`;
		if (this.#failedCatchUps.get(key) === pair) return skip("failed_before");
		// One home with the branch sync: the counts, and whether the upstream once held the local tip.
		const divergence = await readUpstreamDivergence(
			this.#deps.git,
			cwd,
			head.value,
			upstream.value,
		);
		if (!divergence.ok) return err(divergence.error);
		// A branch that is only ahead or only behind has nothing to catch up after a rewrite.
		if (divergence.value.ahead === 0 || divergence.value.behind === 0) {
			return skip("not_diverged");
		}
		// From here a failure is about this pair of tips.
		onTips(pair);

		// The branch takes part in a GitHub stack. This is the expensive read, so it runs only
		// after the cheap checks above say a catch-up may be needed.
		const stack = await this.readStack(workspaceId);
		// A repository with no GitHub remote cannot be in a GitHub stack; that is a normal skip.
		if (!stack.ok && stack.error.code === "github_not_github") return skip("not_in_stack");
		if (!stack.ok) return err(stack.error);
		if (!stack.value.some((entry) => entry.isCurrent)) return skip("not_in_stack");
		if (stopped()) return skip("watch_stopped");

		// Steps 3 and 4: the remote's identity and the baseline ref, with the reflog fallback.
		const remoteUrl = await this.#deps.git.stdout(remoteGetUrl(found.remote), { cwd });
		if (!remoteUrl.ok) return err(remoteUrl.error);
		const remoteIdentity = await this.#deps.git.stdout(hashObjectStdin(remoteUrl.value), { cwd });
		if (!remoteIdentity.ok) return err(remoteIdentity.error);
		if (remoteIdentity.value === "") {
			return err(appError("git_parse", "git hash-object printed nothing for the remote URL."));
		}
		const tuple = [branchRef.value, upstreamRef.value, found.remote, remoteIdentity.value].join(
			"\n",
		);
		const tupleHash = await this.#deps.git.stdout(hashObjectStdin(tuple), { cwd });
		if (!tupleHash.ok) return err(tupleHash.error);
		const baselineRef = syncedBaselineRef(tupleHash.value);
		const baseline = await this.#deps.git.stdout(revParseVerify(baselineRef), { cwd });
		if (!baseline.ok) return err(baseline.error);
		// A tip that is not the baseline must be one the upstream once held (the reflog fallback).
		if (baseline.value !== head.value && !divergence.value.rewritten) {
			return skip(baseline.value === "" ? "no_baseline" : "identity_changed");
		}

		// Step 5: a clean tree and no other git operation.
		const status = await this.#deps.git.stdout(statusPorcelainAll(), { cwd });
		if (!status.ok) return err(status.error);
		if (status.value.trim().length > 0) return skip("dirty_tree");
		const operation = await readOperation(this.#deps.git, cwd);
		if (!operation.ok) return err(operation.error);
		if (operation.value !== "none") return skip("operation_in_progress");

		// Step 6: an ignored file the rebase would overwrite.
		const ignored = await this.#nulPaths(lsFilesIgnoredNul(), cwd);
		if (!ignored.ok) return err(ignored.error);
		const added = await this.#nulPaths(diffTreeAddedNul(head.value, upstream.value), cwd);
		if (!added.ok) return err(added.error);
		if (hasIgnoredPathCollision(ignored.value, added.value)) {
			return skip("ignored_file_collision");
		}

		// Step 7: the guarded rebase, under the worktree lock and then the repo lock (3.0.3).
		const guardEnv = catchUpGuardEnv({
			headRef: branchRef.value,
			localOid: head.value,
			upstreamRef: upstreamRef.value,
			upstreamOid: upstream.value,
			remote: found.remote,
			remoteIdentity: remoteIdentity.value,
		});
		if (stopped()) return skip("watch_stopped");
		return this.#deps.git.withWorktreeAndRepoLocks(cwd, repoRootPath, async () => {
			// The locks may have waited on another git operation; nobody may watch the workspace now.
			if (stopped()) return skip("watch_stopped");
			const command = rebaseOntoUpstream(upstream.value, head.value);
			const rebased = await this.#deps.git.run(command, { cwd, env: guardEnv });
			if (!rebased.ok) return err(rebased.error);
			if (!isSuccessfulExit(command, rebased.value.exitCode)) {
				return err(await this.#abortFailedCatchUp(command, rebased.value, cwd));
			}
			const newTip = await this.#deps.git.stdout(revParseHead(), { cwd });
			if (!newTip.ok) return err(newTip.error);
			// Step 8: compare-and-swap the baseline ref to the new tip.
			const update = updateRefStdin([
				baseline.value === ""
					? `create ${baselineRef} ${newTip.value}`
					: `update ${baselineRef} ${newTip.value} ${baseline.value}`,
			]);
			const updated = await this.#deps.git.run(update, { cwd });
			if (!updated.ok) return err(updated.error);
			if (!isSuccessfulExit(update, updated.value.exitCode)) {
				return err(failedCommandError(update, updated.value));
			}
			return ok({ kind: "rebased", newTip: newTip.value });
		});
	}

	/** Reads a NUL-separated path list, refusing a command that did not succeed. */
	async #nulPaths(command: GitCommand, cwd: string): Promise<Result<string[]>> {
		const result = await this.#deps.git.run(command, { cwd });
		if (!result.ok) return err(result.error);
		if (!isSuccessfulExit(command, result.value.exitCode)) {
			return err(failedCommandError(command, result.value));
		}
		return ok(parseNulPaths(result.value.stdout));
	}

	/**
	 * Stops a refused or failed catch-up rebase so the worktree is not left in the middle of one,
	 * and hands back the rebase's own failure. An abort that also fails is named, so the user can
	 * stop the rebase themselves.
	 */
	async #abortFailedCatchUp(
		command: GitCommand,
		output: ShellOutput,
		cwd: string,
	): Promise<AppError> {
		const failure = failedCommandError(command, output);
		const state = await readOperation(this.#deps.git, cwd);
		if (!state.ok) {
			return appError(
				"github_stack_catch_up_failed",
				`${failure.message} The git state could not be read either: ${state.error.message}`,
				failure,
			);
		}
		if (state.value !== "rebase") return failure;
		const abortCommand = rebaseAbortCommand();
		const aborted = await this.#deps.git.run(abortCommand, { cwd });
		if (!aborted.ok) {
			return appError(
				"github_stack_catch_up_failed",
				`${failure.message} The rebase could not be aborted either: ${aborted.error.message}`,
				failure,
			);
		}
		if (!isSuccessfulExit(abortCommand, aborted.value.exitCode)) {
			const message = aborted.value.stderr.trim() || "git rebase --abort failed";
			return appError(
				"github_stack_catch_up_failed",
				`${failure.message} The rebase could not be aborted: ${message}`,
				failure,
			);
		}
		return failure;
	}

	/**
	 * Runs the automatic catch-up after a timed poll. It never turns a catch-up failure into a
	 * poll failure: the workspace's last PR answer stands, and the failure goes to the caller's
	 * reporter instead.
	 */
	async #catchUpAfterPoll(workspaceId: WorkspaceId, stopped: () => boolean): Promise<void> {
		let failure: AppError;
		try {
			const result = await this.catchUpStackBranch(workspaceId, stopped);
			if (result.ok) {
				this.#reportedCatchUps.delete(String(workspaceId));
				return;
			}
			failure = result.error;
		} catch (cause) {
			failure = appError("github_stack_catch_up_crashed", messageOf(cause));
		}
		// A failure that comes back unchanged on every poll is told once.
		const said = `${failure.code}:${failure.message}`;
		if (this.#reportedCatchUps.get(String(workspaceId)) === said) return;
		this.#reportedCatchUps.set(String(workspaceId), said);
		this.#deps.onCatchUpError?.(workspaceId, failure);
	}

	/** Backs `Actions.pullRequests.requestReview`: adds each GitHub user as a reviewer. */
	requestReview(workspaceId: WorkspaceId, logins: readonly string[]): Promise<Result<void>> {
		const reviewers = [
			...new Set(logins.map((login) => login.trim()).filter((login) => login.length > 0)),
		];
		if (reviewers.length === 0) {
			return Promise.resolve(
				err(appError("github_reviewer_missing", "Choose someone to review this pull request.")),
			);
		}
		return this.#writeAction("requestReview", "requesting_review", workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, prNumber, runOptions } = prepared.value;
			return this.#runPullRequestCommand(
				found,
				runOptions,
				prEdit(prNumber, { addReviewers: reviewers }),
			);
		});
	}

	/** Backs `Actions.pullRequests.removeReviewRequest`: removes one GitHub user as a reviewer. */
	removeReviewRequest(workspaceId: WorkspaceId, login: string): Promise<Result<void>> {
		const reviewer = login.trim();
		if (reviewer.length === 0) {
			return Promise.resolve(
				err(appError("github_reviewer_missing", "Choose a reviewer to remove.")),
			);
		}
		return this.#writeAction("removeReviewRequest", "requesting_review", workspaceId, async () => {
			const prepared = await this.#preparePullRequestWrite(workspaceId);
			if (!prepared.ok) return err(prepared.error);
			const { found, prNumber, runOptions } = prepared.value;
			return this.#runPullRequestCommand(
				found,
				runOptions,
				prEdit(prNumber, { removeReviewers: [reviewer] }),
			);
		});
	}

	/**
	 * Backs `Actions.pullRequests.link`: reads the pull request named by a URL or number from the
	 * workspace's repository, then stores it on the workspace as its pull request. A URL that names
	 * another repository is refused before GitHub is asked. One link runs at a time per workspace.
	 */
	linkPullRequest(workspaceId: WorkspaceId, urlOrNumber: string): Promise<Result<void>> {
		return this.#flights.run(`linkPullRequest:${workspaceId}`, async () => {
			const input = pullRequestInput(urlOrNumber);
			if (!input.ok) return err(input.error);
			const context = await this.#deps.contextOf(workspaceId);
			if (!context.ok) return err(context.error);
			const remoteUrl = await this.#deps.git.stdout(remoteGetUrl(context.value.remote), {
				cwd: context.value.workspacePath,
			});
			if (!remoteUrl.ok) return err(remoteUrl.error);
			const repository = githubRepositoryFromRemote(remoteUrl.value);
			if (!repository.ok) return err(repository.error);
			const named = input.value.repository;
			if (
				named !== null &&
				(named.owner.toLowerCase() !== repository.value.owner.toLowerCase() ||
					named.name.toLowerCase() !== repository.value.name.toLowerCase())
			) {
				return err(
					appError(
						"github_pr_wrong_repository",
						"That pull request belongs to a different repository.",
					),
				);
			}
			const fetched = await this.pullRequestByNumber(remoteUrl.value, input.value.number);
			if (!fetched.ok) return err(fetched.error);
			const store = this.#deps.linkPullRequestToWorkspace;
			if (store === undefined) {
				return err(
					appError(
						"github_link_unavailable",
						"Linking a pull request is not available in this window.",
					),
				);
			}
			const saved = await store(workspaceId, {
				number: fetched.value.number,
				title: fetched.value.title,
				description: null,
			});
			if (!saved.ok) return err(saved.error);
			await this.#refreshAfterWrite(workspaceId);
			return ok(undefined);
		});
	}

	/** Open issues, 50 newest, filtered by the picker's search text (services-map 5B.8.2). */
	async listIssues(remoteUrl: string, query: string): Promise<Result<IssueView[]>> {
		const repository = githubRepositoryFromRemote(remoteUrl);
		if (!repository.ok) return err(repository.error);
		const result = await this.#readGh(repositoryIssues(repositoryPath(repository.value)));
		if (!result.ok) return err(result.error);
		const parsed = parseGithubIssues(result.value);
		if (!parsed.ok) return err(parsed.error);
		return ok(
			parsed.value.filter((issue) =>
				matchesQuery(query, [issue.identifier, issue.title, issue.id]),
			),
		);
	}

	/** Open pull requests for the new-workspace picker, filtered by its search text. */
	async listPullRequests(remoteUrl: string, query: string): Promise<Result<PullRequestSummary[]>> {
		const repository = githubRepositoryFromRemote(remoteUrl);
		if (!repository.ok) return err(repository.error);
		const result = await this.#readGh(repositoryPullRequests(repositoryPath(repository.value)));
		if (!result.ok) return err(result.error);
		const parsed = parseGithubPullRequests(result.value);
		if (!parsed.ok) return err(parsed.error);
		return ok(
			parsed.value.filter((pullRequest) =>
				matchesQuery(query, [
					String(pullRequest.number),
					pullRequest.title,
					pullRequest.branch,
					pullRequest.authorLogin ?? "",
				]),
			),
		);
	}

	/** One pull request by number, for a link the user typed or picked. */
	async pullRequestByNumber(
		remoteUrl: string,
		number: number,
	): Promise<Result<PullRequestSummary>> {
		const repository = githubRepositoryFromRemote(remoteUrl);
		if (!repository.ok) return err(repository.error);
		const result = await this.#readGh(
			pullRequestByNumberCommand(repositoryPath(repository.value), number),
		);
		if (!result.ok) return err(result.error);
		const parsed = parseGithubPullRequest(result.value);
		if (!parsed.ok) return err(parsed.error);
		const { url: _url, body: _body, ...pullRequest } = parsed.value;
		return ok(pullRequest);
	}

	/** The user's eight most recently updated repositories (services-map 5B.1.10). */
	async recentRepos(): Promise<Result<GitHubRepoSummary[]>> {
		const result = await this.#readGh(recentRepositories());
		if (!result.ok) return err(result.error);
		return parseGithubRepos(result.value);
	}

	/** Backs `Actions.issues.attachToWorkspace` for GitHub issues and pull requests. Returns the file path. */
	async attachIssueToWorkspace(
		workspaceId: WorkspaceId,
		issue: Pick<IssueView, "provider" | "id">,
	): Promise<Result<string>> {
		if (issue.provider !== "github") {
			return err(
				appError("issue_provider_unsupported", "Only GitHub issues become GitHub context files."),
			);
		}
		const read = await this.#readIssue(workspaceId, issue.id);
		if (!read.ok) return err(read.error);
		const { context, number, record } = read.value;
		// GitHub's issue endpoint also returns pull requests. They get the pull request file name.
		if (record.pullRequest) {
			return this.attachPullRequestToWorkspace(workspaceId, number);
		}
		const relativePath = githubIssueContextPath(issue.id);
		const written = await this.#writeContextFile(
			context.workspacePath,
			relativePath,
			githubIssueContextFile(record),
		);
		return written.ok ? ok(relativePath) : err(written.error);
	}

	/** Backs PR-09's Link issue dialog: the issue as a `[GITHUB]-<n>.md` attachment for a chat's draft. */
	async issueAttachment(workspaceId: WorkspaceId, id: string): Promise<Result<IssueAttachment>> {
		const read = await this.#readIssue(workspaceId, id);
		if (!read.ok) return err(read.error);
		return ok({
			fileName: githubIssueFileName(String(read.value.number)),
			text: githubIssueContextFile(read.value.record),
			branchName: null,
		});
	}

	/** Reads one issue of the workspace's GitHub repository by its number. */
	async #readIssue(
		workspaceId: WorkspaceId,
		id: string,
	): Promise<Result<{ context: PrWorkspaceContext; number: number; record: GithubIssueRecord }>> {
		const number = issueNumber(id);
		if (!number.ok) return err(number.error);
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const repository = await this.#repositoryOf(context.value);
		if (!repository.ok) return err(repository.error);
		const fetched = await this.#readGh(
			issueByNumberCommand(repositoryPath(repository.value), number.value),
			context.value.workspacePath,
		);
		if (!fetched.ok) return err(fetched.error);
		const parsed = parseGithubIssue(fetched.value);
		if (!parsed.ok) return err(parsed.error);
		return ok({ context: context.value, number: number.value, record: parsed.value });
	}

	/** Writes a pull request as `.context/pull-requests/<n>.md`. Returns the relative path. */
	async attachPullRequestToWorkspace(
		workspaceId: WorkspaceId,
		number: number,
	): Promise<Result<string>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const repository = await this.#repositoryOf(context.value);
		if (!repository.ok) return err(repository.error);
		const fetched = await this.#readGh(
			pullRequestByNumberCommand(repositoryPath(repository.value), number),
			context.value.workspacePath,
		);
		if (!fetched.ok) return err(fetched.error);
		const parsed = parseGithubPullRequest(fetched.value);
		if (!parsed.ok) return err(parsed.error);
		const relativePath = pullRequestContextPath(number);
		const written = await this.#writeContextFile(
			context.value.workspacePath,
			relativePath,
			githubPullRequestContextFile(parsed.value),
		);
		return written.ok ? ok(relativePath) : err(written.error);
	}

	/** Runs a read-only `gh` call and records its health, like every other GitHub action. */
	async #readGh(command: GitCommand, cwd = this.#deps.probeCwd): Promise<Result<string>> {
		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const result = await this.#deps.git.run(command, this.#runOptions(settings.value, cwd));
		if (!result.ok) return err(result.error);
		await this.recordGhResult(result.value);
		if (isSuccessfulExit(command, result.value.exitCode)) return ok(result.value.stdout);
		return err(ghCommandError(command, result.value));
	}

	/** The GitHub repository of a workspace, from its configured remote. */
	async #repositoryOf(context: PrWorkspaceContext): Promise<Result<GithubRepository>> {
		const remote = await this.#remoteOf(context);
		return remote.ok ? ok({ owner: remote.value.owner, name: remote.value.name }) : remote;
	}

	/** The workspace's configured remote, with its host. */
	async #remoteOf(context: PrWorkspaceContext): Promise<Result<GithubRemote>> {
		const url = await this.#deps.git.stdout(remoteGetUrl(context.remote), {
			cwd: context.workspacePath,
		});
		if (!url.ok) return err(url.error);
		return githubRemoteFromUrl(url.value);
	}

	/** Writes a context file under the workspace, creating its folder first. */
	async #writeContextFile(
		workspacePath: string,
		relativePath: string,
		text: string,
	): Promise<Result<void>> {
		const fs = this.#deps.fs;
		if (fs === undefined) {
			return err(
				appError("github_context_unavailable", "The app can't write into this workspace."),
			);
		}
		const absolute = absolutePath(workspacePath, relativePath);
		const slash = absolute.lastIndexOf("/");
		const made = await fs.mkdirp(absolute.slice(0, slash));
		if (!made.ok) return err(made.error);
		return fs.writeTextAtomic(absolute, text);
	}

	/**
	 * Backs `Actions.accounts.setGitHubToken`: the Keychain entry `gh` gets as GH_TOKEN (D029).
	 * A value that is not shaped like a GitHub token is only a warning (`githubTokenWarning`),
	 * which the caller confirms; it still saves, because enterprise tokens can use another prefix.
	 */
	async setToken(token: string | null): Promise<Result<void>> {
		const keychain = this.#deps.keychain;
		if (keychain === undefined) {
			return err(
				appError(
					"github_keychain_unavailable",
					"The app can't reach the Keychain to store the GitHub token.",
				),
			);
		}
		if (token === null) return keychain.delete(GH_PAT_KEYCHAIN_KEY);
		const trimmed = token.trim();
		// An empty token would reach `gh` as an empty GH_TOKEN and break a working sign-in.
		if (trimmed === "") {
			return err(appError("github_token_empty", "Enter a token, or clear the saved one."));
		}
		return keychain.set(GH_PAT_KEYCHAIN_KEY, trimmed);
	}
}
