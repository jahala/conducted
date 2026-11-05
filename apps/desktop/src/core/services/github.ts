/**
 * @feature PR-01 GitHub service: access, health, merge and the personal access token
 * Owns: probing `gh` access (`gh auth status`, the user's login, the git protocol), the access
 * health store, reading and writing the personal access token, merging a workspace's pull
 * request, and polling each watched workspace's pull request in a batch.
 * Behaviour: services-map.md 3.9 (auth probes, method resolution, health), 5B.1.11 (failure
 * classes; only unauthorized breaks access), 5B.1.7 (merge method and dedupe), 3.7.2 and 5B.1.2
 * to 5B.1.4 (the PR poll, its cadence, skip rules and rate-limit gate), ui-map.md 6
 * (Account: GitHub through the `gh` CLI or a personal access token).
 * Must handle: `gh` missing, signed out, unauthorized, offline, an SSO requirement and a missing
 * scope, with the failure class kept on the access state; only unauthorized marks access broken;
 * GH_TOKEN is passed only when the resolved method is pat; a merge is pinned to the local HEAD
 * and refused when HEAD cannot be read; the merge method follows the repo's allowed methods
 * (squash, then rebase, then merge); two merge calls at once send one `gh pr merge`; a token that
 * does not look like one is a warning the caller can confirm, not a refusal, but an empty one is
 * refused; every `gh` result updates the health store; only the newest access check writes the
 * access state.
 * Our design choice: access is the user's own `gh auth login`, or the personal access token the
 * user saved on the Account page (D029). The token is kept in the Keychain and given to `gh` as
 * GH_TOKEN; nothing is brokered per session. The poll schedule and gate are pure functions in
 * pr-polling.ts; `watch` owns the timers. The other write actions and the stack catch-up belong
 * to other features (PR-05, PR-06, PR-08, PR-10, PR-12).
 * Test first: two merge calls at once send one `gh pr merge`.
 */
import {
	type AppError,
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Keychain, Unsubscribe } from "../../platform/platform.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { createSingleFlight, type SingleFlight } from "../async/single-flight.ts";
import {
	configGet,
	lsFiles,
	remoteGetUrl,
	revParseHead,
	revParseVerify,
	statusPorcelainAll,
} from "../git/commands.ts";
import {
	apiRateLimit,
	apiUserLogin,
	authStatus,
	configGetGitProtocol,
	type MergeMethod,
	prBatchQuery,
	prCreateWeb,
	prMerge,
	repoMergeMethodsQuery,
} from "../git/gh-commands.ts";
import { failedCommandError, type GitRunner, isSuccessfulExit } from "../git/runner.ts";
import type { GitHubAccess as GitHubAccessView, IssueView, PullRequest } from "../model.ts";
import { createPrInstruction } from "./agent-instructions.ts";
import type { GitCache } from "./git-cache.ts";
import { buildDeepLink } from "./notifications.ts";
import {
	closedPrIsShown,
	type GraphqlPullRequestNode,
	headBranchFromUpstream,
	type PullRequestExtras,
	rawFromGraphql,
	reconcileMergeable,
	toDeployments,
	toPullRequest,
	toReviewers,
} from "./pr-mapping.ts";
import {
	createRateLimitGate,
	NO_PR_MEMORY_MS,
	type PollRole,
	type RateLimitGate,
	requestedInterval,
	shouldQueryPr,
	updatePolling,
} from "./pr-polling.ts";
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
export const GITHUB_UNAUTHORIZED_MESSAGE =
	"GitHub denied the request. Sign in again with `gh auth login`, or update your token on the Account page.";
export const GITHUB_SAML_SSO_MESSAGE =
	"GitHub requires single sign-on for this organization. Authorize your account for the organization, then try again.";

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
	const scp = /^[^@\s]+@([^:\s/]+):/.exec(trimmed);
	if (scp !== null) return isGithubHost(scp[1]);
	try {
		return isGithubHost(new URL(trimmed).hostname);
	} catch {
		return false;
	}
}

const isGithubHost = (host: string | undefined): boolean => {
	const name = (host ?? "").toLowerCase();
	return name === "github.com" || name === "ssh.github.com";
};

/** The forge a remote gets: GitHub for github.com only, local git for everything else. */
export function forgeForRemoteUrl(url: string): "github" | "local" {
	return isGithubRemoteUrl(url) ? "github" : "local";
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
}

export interface PrWorkspaceContext {
	workspaceId: WorkspaceId;
	workspacePath: string;
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
	| "ignored_file_collision";

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
	/** The last pull request info of each workspace, shown before the first poll answers (DATA-07). */
	cache: GitCache;
	agent: AgentMessenger;
	contextOf: (workspaceId: WorkspaceId) => Promise<Result<PrWorkspaceContext>>;
	/** Called when a PR becomes merged, so the workspace service can archive on merge. */
	onMerged: (workspaceId: WorkspaceId, prNumber: number) => void;
	now: () => number;
	/** The Keychain the Account page's token is kept in (D029). */
	keychain?: Pick<Keychain, "get" | "set" | "delete">;
	/** Reads `gh_auth_method` (services-map 3.9, D029). */
	setting?: <T>(key: string) => T;
	/** Folder for probes that belong to no workspace, normally the user's home folder. */
	probeCwd: string;
}

interface PollWatcher {
	readonly roles: Map<PollRole, number>;
	stopped: boolean;
	timer: ReturnType<typeof setTimeout> | null;
}

interface PrBatchResponse {
	data?: {
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

/** One parsed batched PR answer: the PR node, and the repository facts the poll needs. */
export interface PrBatchAnswer {
	node: GraphqlPullRequestNode | null;
	viewerCanMerge: boolean;
	mergeMethod: "squash" | "rebase" | "merge";
}

/** Reads `gh api graphql` output. A bad answer is an error, never an empty PR. */
export function parsePrBatchAnswer(text: string): Result<PrBatchAnswer> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err(appError("github_bad_answer", "GitHub's answer was not JSON."));
	}
	if (typeof parsed !== "object" || parsed === null) {
		return err(appError("github_bad_answer", "GitHub's answer was not a JSON object."));
	}
	const repository = (parsed as PrBatchResponse).data?.repository;
	if (repository === undefined || repository === null) {
		return err(appError("github_bad_answer", "GitHub's answer had no repository."));
	}
	const permission = repository.viewerPermission ?? "";
	return ok({
		node: repository.pr0ByNumber ?? repository.pr0ByBranch?.nodes?.[0] ?? null,
		viewerCanMerge: permission === "ADMIN" || permission === "MAINTAIN" || permission === "WRITE",
		mergeMethod:
			repository.squashMergeAllowed === true
				? "squash"
				: repository.rebaseMergeAllowed === true
					? "rebase"
					: "merge",
	});
}

/** Required check names are not part of the poll answer, so no check is marked required here. */
const NO_REQUIRED_CHECKS: ReadonlySet<string> = new Set();

const parseTimestamp = (value: string): number | null => {
	const at = Date.parse(value);
	return Number.isNaN(at) ? null : at;
};

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
	/** When each watched workspace last asked GitHub, for the interval check. */
	readonly #lastPolledAt = new Map<string, number>();
	/** The head commit of the last PR shown, for the UNKNOWN mergeability guard. */
	readonly #headByWorkspace = new Map<string, string>();
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

	/** Backs `Actions.app.recheckGitHubAccess`: runs the access probes again and updates the store. */
	async recheckAccess(): Promise<Result<void>> {
		const result = await this.checkAccess();
		return result.ok
			? ok(undefined)
			: err(appError("github_refresh_failed", GITHUB_REFRESH_FAILED_MESSAGE, result.error));
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
	 * the workspace shares one timer; the smallest requested interval wins.
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

	/** Polls one workspace once. A newer poll's answer wins if two overlap. */
	async pollNow(workspaceId: WorkspaceId): Promise<Result<void>> {
		const key = String(workspaceId);
		const ticket = this.#pollLatest.begin(key);
		const result = await this.#pollWorkspace(workspaceId);
		const latest = this.#pollLatest.isLatest(ticket);
		this.#pollLatest.settle(ticket);
		this.#lastPolledAt.set(key, this.#deps.now());
		if (!latest) return ok(undefined);
		if (!result.ok) {
			this.#recordPollFailure(workspaceId, result.error);
			return err(result.error);
		}
		this.store.setState((state) => ({
			byWorkspace: { ...state.byWorkspace, [key]: result.value },
		}));
		return ok(undefined);
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
	}

	async #pollTick(workspaceId: WorkspaceId, watcher: PollWatcher): Promise<void> {
		if (watcher.stopped) return;
		const key = String(workspaceId);
		const pr = this.store.getState().byWorkspace[key]?.pullRequest ?? null;
		const subscriptions = [...watcher.roles].map(([role]) => ({
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
		const remaining = await this.#rateGate.remaining();
		const decision = updatePolling(subscriptions, remaining);
		if (
			decision.poll &&
			this.#deps.now() - (this.#lastPolledAt.get(key) ?? 0) >= decision.intervalMs
		) {
			await this.pollNow(workspaceId);
		}
		if (watcher.stopped) return;
		watcher.timer = setTimeout(() => {
			void this.#pollTick(workspaceId, watcher);
		}, decision.intervalMs);
	}

	async #pollWorkspace(workspaceId: WorkspaceId): Promise<Result<WorkspacePrEntry>> {
		const context = await this.#deps.contextOf(workspaceId);
		if (!context.ok) return err(context.error);
		const found = context.value;
		const key = String(workspaceId);
		const now = this.#deps.now();
		const remembered = this.#noPrUntil.get(key);
		if (found.prNumber === null && remembered !== undefined && now < remembered) {
			return ok({ pullRequest: null, unavailable: "no_pr", fetchedAt: now });
		}

		const upstream = await this.#upstreamBranch(found);
		if (!upstream.ok) return err(upstream.error);
		const headBranch = upstream.value?.branch ?? found.branch;
		const pushRemote = upstream.value?.remote ?? found.remote;
		const pushed = await this.#branchPushed(found.workspacePath, pushRemote, headBranch);
		if (!pushed.ok) return err(pushed.error);
		if (!shouldQueryPr(pushed.value, found.prNumber)) {
			this.#noPrUntil.set(key, now + NO_PR_MEMORY_MS);
			return ok({ pullRequest: null, unavailable: "no_pr", fetchedAt: now });
		}

		const settings = await this.#ghSettings();
		if (!settings.ok) return err(settings.error);
		const command = prBatchQuery([{ headBranch, prNumber: found.prNumber }]);
		const response = await this.#deps.git.run(
			command,
			this.#runOptions(settings.value, found.workspacePath),
		);
		if (!response.ok) return err(response.error);
		await this.recordGhResult(response.value);
		if (!isSuccessfulExit(command, response.value.exitCode)) {
			return err(failedCommandError(command, response.value));
		}
		const answer = parsePrBatchAnswer(response.value.stdout);
		if (!answer.ok) return err(answer.error);
		if (answer.value.node === null) {
			this.#noPrUntil.set(key, now + NO_PR_MEMORY_MS);
			return ok({ pullRequest: null, unavailable: "no_pr", fetchedAt: now });
		}
		this.#noPrUntil.delete(key);
		return this.#toWorkspaceEntry(key, found, answer.value, now);
	}

	#toWorkspaceEntry(
		key: string,
		found: PrWorkspaceContext,
		answer: PrBatchAnswer,
		now: number,
	): Result<WorkspacePrEntry> {
		const node = answer.node;
		if (node === null) {
			return err(appError("github_bad_answer", "GitHub's answer had no pull request."));
		}
		const raw = rawFromGraphql(node);
		const headBranch = raw.headRefName ?? found.branch;
		const state: PullRequest["state"] =
			raw.state === "MERGED"
				? "merged"
				: raw.state === "CLOSED"
					? "closed"
					: raw.isDraft
						? "draft"
						: "open";
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
	 * Reads the GraphQL budget left for the gate. Null means "unknown", which polls at the normal
	 * rate; a failed probe is not a reason to invent a number.
	 */
	async #readRateLimit(): Promise<number | null> {
		const settings = await this.#ghSettings();
		if (!settings.ok) return null;
		const command = apiRateLimit();
		const result = await this.#deps.git.run(command, this.#runOptions(settings.value));
		if (!result.ok) return null;
		await this.recordGhResult(result.value);
		if (!isSuccessfulExit(command, result.value.exitCode)) return null;
		const budget = parseGraphqlBudget(result.value.stdout);
		// A malformed probe leaves the budget unknown, so polling keeps its normal rate.
		return budget.ok ? budget.value : null;
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
		this.store.setState((state) => ({
			byWorkspace: {
				...state.byWorkspace,
				[key]: {
					pullRequest: previous?.pullRequest ?? null,
					unavailable,
					fetchedAt: this.#deps.now(),
				},
			},
		}));
	}

	/** Backs `Actions.pullRequests.create`: asks the agent to open the PR. */
	async create(workspaceId: WorkspaceId): Promise<Result<void>> {
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

	/** Opens GitHub's new-PR page in the browser. */
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

	/** The target branch without its remote prefix, as `gh pr create --base` expects it. */
	#targetBranchOf(context: PrWorkspaceContext): Result<string> {
		const stored = context.targetBranch?.trim() ?? "";
		if (stored.length === 0) {
			return err(appError("github_target_unknown", "This workspace has no target branch."));
		}
		const prefix = `${context.remote}/`;
		return ok(
			context.remote.length > 0 && stored.startsWith(prefix) ? stored.slice(prefix.length) : stored,
		);
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

	merge(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#flights.run(`merge:${workspaceId}`, async (): Promise<Result<void>> => {
			const context = await this.#deps.contextOf(workspaceId);
			if (!context.ok) return err(context.error);
			const { workspacePath, prNumber } = context.value;
			if (prNumber === null) {
				return err(appError("github_pr_missing", "This workspace has no pull request yet."));
			}

			const cwd = workspacePath;
			const settings = await this.#ghSettings();
			if (!settings.ok) return err(settings.error);
			const runOptions = this.#runOptions(settings.value, cwd);

			const head = await this.#deps.git.stdout(revParseHead(), { cwd });
			if (!head.ok) return err(head.error);
			if (head.value.length === 0) {
				return err(
					appError("github_head_unknown", "Merge blocked: can't read the workspace's HEAD commit."),
				);
			}

			const mergeMethodsQuery = repoMergeMethodsQuery();
			const allowed = await this.#deps.git.run(mergeMethodsQuery, runOptions);
			if (!allowed.ok) return err(allowed.error);
			await this.recordGhResult(allowed.value);
			if (!isSuccessfulExit(mergeMethodsQuery, allowed.value.exitCode)) {
				return err(failedCommandError(mergeMethodsQuery, allowed.value));
			}
			const method = chooseMergeMethod(allowed.value.stdout.trim());
			if (method === null) {
				return err(
					appError(
						"github_merge_not_allowed",
						"This repository doesn't allow merging pull requests.",
					),
				);
			}

			const command = prMerge(prNumber, method, head.value, false);
			return this.#deps.git.withWorktreeLock(workspacePath, async (): Promise<Result<void>> => {
				const result = await this.#deps.git.run(command, runOptions);
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
			});
		});
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

	/**
	 * Catches a stack branch up with its rewritten upstream (PR-12). Runs on its own when polling
	 * sees the branch fall behind; skipping is the normal result, see `CatchUpSkipReason`.
	 */
	catchUpStackBranch(_workspaceId: WorkspaceId): Promise<Result<CatchUpOutcome>> {
		return notImplemented("PR-12");
	}

	/** Backs `Actions.pullRequests.requestReview`. */
	requestReview(_workspaceId: WorkspaceId, _logins: readonly string[]): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	/** Backs `Actions.pullRequests.removeReviewRequest`. */
	removeReviewRequest(_workspaceId: WorkspaceId, _login: string): Promise<Result<void>> {
		return notImplemented("PR-06");
	}

	/** Backs `Actions.pullRequests.link`. */
	linkPullRequest(_workspaceId: WorkspaceId, _urlOrNumber: string): Promise<Result<void>> {
		return notImplemented("PR-10");
	}

	/** Backs `Actions.issues.attachToWorkspace` for GitHub issues and pull requests. Returns the file path. */
	attachIssueToWorkspace(
		_workspaceId: WorkspaceId,
		_issue: Pick<IssueView, "provider" | "id">,
	): Promise<Result<string>> {
		return notImplemented("PR-11");
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
