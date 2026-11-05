/**
 * @feature PR-01 Catalogue of every gh (GitHub CLI) invocation the app makes
 * Owns: one pure function per `gh` call (and the read-only `gt` Graphite calls), each returning a
 * `GitCommand` value. The runner executes it, in the workspace folder, so `gh` finds the repo.
 * Behaviour: services-map.md 3.7 (PR create, read, write actions), 3.8 (stacks, Graphite),
 * 3.9 (auth probes), 5B.1 (fields, batching, rate-limit gate).
 * Must handle: every value reaches `gh` as its own argument; GraphQL variables go through
 * `-F`/`-f` flags, never string-built into the query; a merge is pinned to the local HEAD with
 * `--match-head-commit`, and an approval to the head commit id, so the app never acts on a PR
 * that differs from what the user sees.
 * Our design choice: GitHub access is the user's own `gh auth login` (method `cli`), or the
 * personal access token saved on the Account page, which the service passes to `gh` as GH_TOKEN
 * (D029). These functions only build the argument list; nothing here reads a secret. The GraphQL
 * query is written from GitHub's public schema, not copied. `gh` comes from the captured
 * login-shell PATH.
 * Test first: prMerge(12, "squash", "abc", false) pins the merge with --match-head-commit.
 */
import type { GitCommand } from "./commands.ts";

export const GH_GRAPHQL_TIMEOUT_MS = 10_000;

const gh = (
	args: readonly string[],
	extra: Partial<Omit<GitCommand, "program" | "args">> = {},
): GitCommand => ({
	program: "gh",
	args,
	retryOnLock: false,
	...extra,
});

// ---------------------------------------------------------------- access probes (PR-01)

export const authStatus = (): GitCommand => gh(["auth", "status"], { okExitCodes: [0, 1] });
export const apiUserLogin = (): GitCommand => gh(["api", "user", "--jq", ".login"]);
/** The protocol `gh` uses for git operations: "https" or "ssh". Exit 1 means it is unset. */
export const configGetGitProtocol = (): GitCommand =>
	gh(["config", "get", "git_protocol"], { okExitCodes: [0, 1] });
export const apiRateLimit = (): GitCommand =>
	gh(["api", "rate_limit"], { timeoutMs: GH_GRAPHQL_TIMEOUT_MS });
export const repoCanView = (ownerSlashName: string): GitCommand =>
	gh(["repo", "view", ownerSlashName, "--json", "name", "-q", ".name"], { okExitCodes: [0, 1] });

// ---------------------------------------------------------------- reading PR state (PR-03)

/** The fields we ask for on every pull request. GitHub's public GraphQL schema, our selection. */
export const PR_FIELDS_FRAGMENT = `
fragment PrFields on PullRequest {
  number
  url
  title
  body
  state
  isDraft
  mergedAt
  mergeable
  mergeStateStatus
  reviewDecision
  baseRefName
  baseRef { target { oid } }
  headRefName
  headRefOid
  createdAt
  updatedAt
  author { login avatarUrl }
  viewerDidAuthor
  viewerLatestReview { state commit { oid } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login avatarUrl } ... on Team { slug avatarUrl } } } }
  latestReviews(first: 20) { nodes { author { login avatarUrl } state submittedAt } }
  autoMergeRequest { enabledAt }
  mergeQueueEntry { state position }
  headRef {
    target {
      ... on Commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              ... on CheckRun { name status conclusion detailsUrl startedAt completedAt checkSuite { workflowRun { workflow { name } } } }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
        deployments(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
          nodes {
            environment
            createdAt
            updatedAt
            latestStatus { state environmentUrl createdAt updatedAt }
          }
        }
      }
    }
  }
}`;

export interface PrLookup {
	/** Look up by head branch name (the branch as pushed), or by PR number when known. */
	headBranch: string;
	prNumber: number | null;
}

/**
 * One batched query for several workspaces of one repository (services-map 3.7.2). Entry `i`
 * becomes alias `pr<i>` and variables `headRefName<i>` and `prNumber<i>`. `owner` and `repo`
 * default to gh's own detection from the working folder via the `{owner}`/`{repo}` placeholders.
 */
export const prBatchQuery = (lookups: readonly PrLookup[]): GitCommand => {
	const declarations = lookups
		.map((_, i) => `$headRefName${i}: String!, $prNumber${i}: Int!, $hasPrNumber${i}: Boolean!`)
		.join(", ");
	const aliases = lookups
		.map(
			(_, i) => `
    pr${i}ByBranch: pullRequests(first: 5, headRefName: $headRefName${i}, states: [OPEN, MERGED], orderBy: {field: CREATED_AT, direction: DESC}) @skip(if: $hasPrNumber${i}) { nodes { ...PrFields } }
    pr${i}ByNumber: pullRequest(number: $prNumber${i}) @include(if: $hasPrNumber${i}) { ...PrFields }`,
		)
		.join("");
	const query = `query($owner: String!, $repo: String!, ${declarations}) {
  viewer { login }
  rateLimit { cost remaining }
  repository(owner: $owner, name: $repo) {
    viewerPermission
    squashMergeAllowed
    rebaseMergeAllowed
    mergeCommitAllowed${aliases}
  }
}
${PR_FIELDS_FRAGMENT}`;
	const variables = lookups.flatMap((lookup, i) => [
		"-f",
		`headRefName${i}=${lookup.headBranch}`,
		"-F",
		`prNumber${i}=${lookup.prNumber ?? 0}`,
		"-F",
		`hasPrNumber${i}=${lookup.prNumber !== null}`,
	]);
	return gh(
		[
			"api",
			"graphql",
			"-F",
			"owner={owner}",
			"-F",
			"repo={repo}",
			...variables,
			"-f",
			`query=${query}`,
		],
		{ timeoutMs: GH_GRAPHQL_TIMEOUT_MS },
	);
};

export const reviewThreadsQuery = (prNumber: number, cursor: string | null): GitCommand => {
	const query = `query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  rateLimit { cost }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isOutdated isResolved path line startLine originalLine diffSide
          comments(first: 50) {
            nodes { id databaseId body diffHunk url createdAt updatedAt author { login } replyTo { databaseId } }
          }
        }
      }
    }
  }
}`;
	return gh(
		[
			"api",
			"graphql",
			"-F",
			"owner={owner}",
			"-F",
			"repo={repo}",
			"-F",
			`prNumber=${prNumber}`,
			...(cursor === null ? [] : ["-f", `cursor=${cursor}`]),
			"-f",
			`query=${query}`,
		],
		{ timeoutMs: GH_GRAPHQL_TIMEOUT_MS },
	);
};

export const resolveReviewThread = (threadId: string): GitCommand =>
	gh([
		"api",
		"graphql",
		"-f",
		`threadId=${threadId}`,
		"-f",
		"query=mutation($threadId: ID!) { resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } } }",
	]);

export const repoMergeMethodsQuery = (): GitCommand =>
	gh([
		"api",
		"graphql",
		"-F",
		"owner={owner}",
		"-F",
		"repo={repo}",
		"-f",
		"query=query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { squashMergeAllowed rebaseMergeAllowed mergeCommitAllowed } }",
		"--jq",
		"[.data.repository.squashMergeAllowed, .data.repository.rebaseMergeAllowed, .data.repository.mergeCommitAllowed]",
	]);

export const prListForBranch = (branch: string): GitCommand =>
	gh(["pr", "list", "--head", branch, "--state", "all", "--json", "state"]);

// ---------------------------------------------------------------- write actions (PR-06)

export type MergeMethod = "squash" | "rebase" | "merge";

export const prMerge = (
	number: number,
	method: MergeMethod,
	matchHeadCommit: string,
	auto: boolean,
): GitCommand =>
	gh([
		"pr",
		"merge",
		String(number),
		`--${method}`,
		...(auto ? ["--auto"] : []),
		"--match-head-commit",
		matchHeadCommit,
	]);
export const prMergeDisableAuto = (number: number): GitCommand =>
	gh(["pr", "merge", String(number), "--disable-auto"]);
export const prViewState = (number: number): GitCommand =>
	gh(["pr", "view", String(number), "--json", "state", "--jq", ".state"]);
export const prReady = (number: number): GitCommand => gh(["pr", "ready", String(number)]);
export const prEdit = (
	number: number,
	changes: { title?: string; body?: string; base?: string },
): GitCommand =>
	gh([
		"pr",
		"edit",
		String(number),
		...(changes.title === undefined ? [] : ["--title", changes.title]),
		...(changes.body === undefined ? [] : ["--body", changes.body]),
		...(changes.base === undefined ? [] : ["--base", changes.base]),
	]);
export const prApprove = (number: number, headCommitId: string): GitCommand =>
	gh([
		"api",
		`repos/{owner}/{repo}/pulls/${number}/reviews`,
		"-f",
		"event=APPROVE",
		"-f",
		`commit_id=${headCommitId}`,
	]);
/** Opens GitHub's own "new pull request" page; used by "Open on GitHub". */
export const prCreateWeb = (base: string, head: string): GitCommand =>
	gh(["pr", "create", "--web", "--base", base, "--head", head]);
export const runRerunFailed = (runId: string): GitCommand =>
	gh(["run", "rerun", runId, "--failed"]);
/** Log of one failed job. The caller keeps the last 1000 lines. */
export const jobLogs = (jobId: string): GitCommand =>
	gh(["api", `repos/{owner}/{repo}/actions/jobs/${jobId}/logs`], { okExitCodes: [0, 1] });
export const checkRunAnnotations = (checkRunUrl: string): GitCommand =>
	gh(["api", `${checkRunUrl}/annotations`, "--paginate", "--jq", 'map(.message) | join("\\n\\n")']);

// ---------------------------------------------------------------- stacks and Graphite (PR-08)

export const stackSync = (): GitCommand => gh(["stack", "sync"], { network: true });
export const stackMerge = (number: number, method: MergeMethod): GitCommand =>
	gh(["stack", "merge", String(number), "--yes", `--${method}`]);
export const stackMembers = (stackNumber: number): GitCommand =>
	gh(["api", `repos/{owner}/{repo}/stacks/${stackNumber}`]);
export const graphiteInstalled = (): GitCommand => ({
	program: "gt",
	args: ["--version"],
	okExitCodes: [0, 1, 127],
	retryOnLock: false,
});
export const graphiteState = (): GitCommand => ({
	program: "gt",
	args: ["state"],
	timeoutMs: 30_000,
	retryOnLock: false,
});
export const graphiteCheckout = (branch: string): GitCommand => ({
	program: "gt",
	args: ["checkout", branch],
	retryOnLock: false,
});
