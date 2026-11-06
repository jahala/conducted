/**
 * @feature PR-09 Linear issues: list, link, attach as context
 * Owns: asking Linear for the user's issues and turning a chosen issue into a context file for a
 * workspace.
 * Behaviour: services-map.md 5B.8.1 (queries: my active issues, search, by identifier, team ids
 * and repository suggestions), 5B.8.3 (an issue becomes a file
 * `.context/attachments/<key>/[LINEAR]-<identifier>.md`), frontend.md 7 (the context carried into
 * a chat), ui-map.md 6 (Account connects Linear with an API key).
 * Must handle: no key stored (state "not connected", no request); a 401 answer (state "key
 * rejected", and later calls make no request until the key changes); an identifier like `ABC-123`
 * runs the by-id query and the search together; lists are cached for 15 seconds, by-id for 60 and
 * team ids and suggestions for 600; the key never reaches a message or a log; only the newest
 * issue list changes the store; a failed write is reported instead of returning a path that does
 * not exist.
 * Our design choice: the user pastes a personal Linear API key, stored in the Keychain (D035).
 * There is no OAuth because there is no backend to run the callback.
 * Test first: a 401 moves the state to "key rejected" and a second call makes no request.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { FileSystem, Platform } from "../../platform/platform.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import type { IssueView } from "../model.ts";
import { sanitizeIssueKey } from "./github.ts";

export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
export const LINEAR_API_KEY_KEYCHAIN_KEY = "linear_api_key";
/** An identifier such as `ABC-123`, taken from services-map.md 5B.8.1. */
export const LINEAR_IDENTIFIER_REGEX = /^(\w{1,7})-(\d{1,9})$/;
export const LINEAR_MY_ISSUES_CACHE_MS = 15_000;
export const LINEAR_SEARCH_CACHE_MS = 15_000;
export const LINEAR_BY_ID_CACHE_MS = 60_000;
export const LINEAR_TEAM_CACHE_MS = 600_000;
export const LINEAR_REQUEST_TIMEOUT_MS = 15_000;

export interface LinearComment {
	id: string;
	body: string;
	createdAt: number;
	user: string | null;
}

export interface LinearTeam {
	id: string;
	name: string;
	key: string;
}

export interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	url: string;
	branchName: string | null;
	createdAt: number;
	updatedAt: number;
	state: { name: string; type: string };
	assignee: string | null;
	priorityLabel: string | null;
	labels: string[];
	team: LinearTeam | null;
	comments: LinearComment[];
}

export interface RepositorySuggestion {
	repositoryFullName: string;
	confidence: number;
}

export interface LinearHttp {
	/** POSTs JSON and returns the status and parsed JSON body. */
	postJson(
		url: string,
		headers: Readonly<Record<string, string>>,
		body: unknown,
	): Promise<Result<{ status: number; json: unknown }>>;
}

/** Runs Linear's GraphQL calls through Platform.http (PLAT-30), never through a shell. */
export function createLinearHttp(http: Platform["http"]): LinearHttp {
	return {
		postJson: async (url, headers, body) => {
			const response = await http.fetch({
				url,
				method: "POST",
				headers,
				body: JSON.stringify(body),
				timeoutMs: LINEAR_REQUEST_TIMEOUT_MS,
			});
			if (!response.ok) return response;
			let json: unknown;
			try {
				json = JSON.parse(response.value.body);
			} catch (cause) {
				return err(
					appError("linear_response_invalid", "Linear answered with text that is not JSON.", cause),
				);
			}
			return ok({ status: response.value.status, json });
		},
	};
}

export type LinearConnection = "unknown" | "not_connected" | "connected" | "key_rejected";

export interface LinearAccount {
	name: string;
	organization: string | null;
}

export interface LinearState {
	connection: LinearConnection;
	myIssues: readonly LinearIssue[];
	account: LinearAccount | null;
}

export interface LinearServiceDeps {
	http: LinearHttp;
	keychain: Platform["keychain"];
	fs: Pick<FileSystem, "mkdirp" | "writeTextAtomic">;
	workspacePathOf: (workspaceId: WorkspaceId) => Promise<Result<string>>;
	now: () => number;
}

const ISSUE_FIELDS = `
	id
	identifier
	title
	description
	url
	createdAt
	updatedAt
	branchName
	priorityLabel
	state { id name type color }
	assignee { id name }
	labels { nodes { id name } }
	team { id name key }
	comments { nodes { id body createdAt user { name } } }
`;

const MY_ACTIVE_ISSUES_QUERY = `query MyActiveIssues {
	viewer {
		id
		assignedIssues(first: 50, filter: { state: { type: { neq: "completed" } } }) {
			nodes {${ISSUE_FIELDS}}
		}
	}
}`;

const SEARCH_ISSUES_QUERY = `query SearchIssues($term: String!) {
	searchIssues(term: $term, first: 30, filter: { state: { type: { neq: "completed" } } }) {
		nodes {${ISSUE_FIELDS}}
	}
}`;

const ISSUE_BY_ID_QUERY = `query GetIssueById($id: String!) {
	issue(id: $id) {${ISSUE_FIELDS}}
}`;

const VIEWER_QUERY = `query Viewer {
	viewer { id name organization { id name } }
}`;

const TEAM_IDS_QUERY = `query GetUserTeamIds {
	viewer { teams(first: 50) { nodes { id key name } } }
}`;

const REPOSITORY_SUGGESTIONS_QUERY = `query GetIssueRepositorySuggestions($issueId: String!, $candidateRepositories: [String!]!) {
	issueRepositorySuggestions(issueId: $issueId, candidateRepositories: $candidateRepositories) {
		repositoryFullName
		confidence
	}
}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const invalidResponse = (detail: string): Result<never> =>
	err(
		appError(
			"linear_response_invalid",
			`Linear answered with something this app cannot read: ${detail}.`,
		),
	);

const text = (value: unknown, field: string): Result<string> =>
	typeof value === "string" && value.length > 0
		? ok(value)
		: invalidResponse(`${field} is missing`);

const optionalText = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value : null;

const time = (value: unknown, field: string): Result<number> => {
	if (typeof value !== "string") return invalidResponse(`${field} is missing`);
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? invalidResponse(`${field} is not a date`) : ok(parsed);
};

function connectionNodes(value: unknown): Result<unknown[]> {
	if (value === undefined || value === null) return ok([]);
	if (!isRecord(value) || !Array.isArray(value.nodes)) {
		return invalidResponse("a connection has no nodes");
	}
	return ok(value.nodes);
}

function parseComment(raw: unknown): Result<LinearComment> {
	if (!isRecord(raw)) return invalidResponse("a comment is not an object");
	const id = text(raw.id, "a comment id");
	if (!id.ok) return id;
	const body = typeof raw.body === "string" ? raw.body : "";
	const createdAt = time(raw.createdAt, "a comment createdAt");
	if (!createdAt.ok) return createdAt;
	const user = isRecord(raw.user) ? optionalText(raw.user.name) : null;
	return ok({ id: id.value, body, createdAt: createdAt.value, user });
}

function parseTeam(raw: unknown): Result<LinearTeam | null> {
	if (raw === undefined || raw === null) return ok(null);
	if (!isRecord(raw)) return invalidResponse("a team is not an object");
	const id = text(raw.id, "a team id");
	if (!id.ok) return id;
	const name = text(raw.name, "a team name");
	if (!name.ok) return name;
	const key = text(raw.key, "a team key");
	if (!key.ok) return key;
	return ok({ id: id.value, name: name.value, key: key.value });
}

export function parseLinearIssue(raw: unknown): Result<LinearIssue> {
	if (!isRecord(raw)) return invalidResponse("an issue is not an object");
	const id = text(raw.id, "an issue id");
	if (!id.ok) return id;
	const identifier = text(raw.identifier, "an issue identifier");
	if (!identifier.ok) return identifier;
	const title = text(raw.title, "an issue title");
	if (!title.ok) return title;
	const url = text(raw.url, "an issue url");
	if (!url.ok) return url;
	if (!isRecord(raw.state)) return invalidResponse("an issue has no state");
	const stateName = text(raw.state.name, "a state name");
	if (!stateName.ok) return stateName;
	const stateType = text(raw.state.type, "a state type");
	if (!stateType.ok) return stateType;
	const createdAt = time(raw.createdAt, "an issue createdAt");
	if (!createdAt.ok) return createdAt;
	const updatedAt = time(raw.updatedAt, "an issue updatedAt");
	if (!updatedAt.ok) return updatedAt;
	const labelsRaw = connectionNodes(raw.labels);
	if (!labelsRaw.ok) return labelsRaw;
	const commentsRaw = connectionNodes(raw.comments);
	if (!commentsRaw.ok) return commentsRaw;
	const labels: string[] = [];
	for (const label of labelsRaw.value) {
		if (!isRecord(label)) return invalidResponse("a label is not an object");
		const name = text(label.name, "a label name");
		if (!name.ok) return name;
		labels.push(name.value);
	}
	const comments: LinearComment[] = [];
	for (const comment of commentsRaw.value) {
		const parsed = parseComment(comment);
		if (!parsed.ok) return parsed;
		comments.push(parsed.value);
	}
	const team = parseTeam(raw.team);
	if (!team.ok) return team;
	const assignee = isRecord(raw.assignee) ? optionalText(raw.assignee.name) : null;
	return ok({
		id: id.value,
		identifier: identifier.value,
		title: title.value,
		description: optionalText(raw.description),
		url: url.value,
		branchName: optionalText(raw.branchName),
		createdAt: createdAt.value,
		updatedAt: updatedAt.value,
		state: { name: stateName.value, type: stateType.value },
		assignee,
		priorityLabel: optionalText(raw.priorityLabel),
		labels,
		team: team.value,
		comments,
	});
}

function parseIssueList(value: unknown): Result<LinearIssue[]> {
	const nodes = connectionNodes(value);
	if (!nodes.ok) return nodes;
	const issues: LinearIssue[] = [];
	for (const node of nodes.value) {
		const parsed = parseLinearIssue(node);
		if (!parsed.ok) return parsed;
		issues.push(parsed.value);
	}
	return ok(issues);
}

/** The branch name Linear suggests, or null when the issue has none. */
export function suggestedBranchName(issue: LinearIssue): string | null {
	const branch = issue.branchName?.trim() ?? "";
	return branch === "" ? null : branch;
}

/** The issue as the screens' common `IssueView` shape. */
export function linearIssueToView(issue: LinearIssue): IssueView {
	return {
		provider: "linear",
		id: issue.id,
		identifier: issue.identifier,
		title: issue.title,
		url: issue.url,
		state: issue.state.name,
		branchName: suggestedBranchName(issue),
		updatedAt: issue.updatedAt,
	};
}

/** Relative path of a Linear issue's context file inside a workspace. */
export function linearIssueContextPath(issue: Pick<LinearIssue, "id" | "identifier">): string {
	return `.context/attachments/${sanitizeIssueKey(`linear:${issue.id}`)}/[LINEAR]-${issue.identifier}.md`;
}

/** The Markdown a Linear issue becomes, with its comments and times (services-map.md 5B.8.1). */
export function linearIssueContextFile(issue: LinearIssue): string {
	const created = new Date(issue.createdAt).toISOString();
	const updated = new Date(issue.updatedAt).toISOString();
	const description = issue.description?.trim() ?? "";
	const comments =
		issue.comments.length === 0
			? "No comments."
			: issue.comments
					.map((comment) => {
						const author = comment.user ?? "Unknown";
						const at = new Date(comment.createdAt).toISOString();
						return `### ${author} - ${at}\n\n${comment.body.trim() || "No text."}`;
					})
					.join("\n\n");
	return `# ${issue.identifier}: ${issue.title}

- Source: ${issue.url}
- State: ${issue.state.name}
- Team: ${issue.team === null ? "None" : `${issue.team.name} (${issue.team.key})`}
- Assignee: ${issue.assignee ?? "Unassigned"}
- Priority: ${issue.priorityLabel ?? "No priority"}
- Created: ${created}
- Updated: ${updated}
- Branch: ${suggestedBranchName(issue) ?? "None"}
- Labels: ${issue.labels.length === 0 ? "None" : issue.labels.join(", ")}

${description.length > 0 ? description : "No description."}

## Comments

${comments}
`;
}

interface CacheEntry {
	at: number;
	value: unknown;
}

const keyRejectedError = () =>
	appError("linear_key_rejected", "Linear rejected the API key. Enter a new key in Settings.");

const notConnectedError = () => appError("linear_not_connected", "Connect Linear to list issues.");

export class LinearService {
	readonly store: StoreApi<LinearState>;
	readonly #deps: LinearServiceDeps;
	readonly #cache = new Map<string, CacheEntry>();
	/** Only the newest issue list changes the store; an older answer is still returned. */
	readonly #issueReads = createLatestWins<"myIssues">();
	/** Only the newest request changes the connection, so a late 401 cannot undo a new key. */
	readonly #connectionWrites = createLatestWins<"connection">();

	constructor(deps: LinearServiceDeps) {
		this.#deps = deps;
		this.store = createStore<LinearState>(() => ({
			connection: "unknown",
			myIssues: [],
			account: null,
		}));
	}

	/** Backs `Actions.accounts.setLinearKey`. Null removes the key from the Keychain. */
	async setApiKey(key: string | null): Promise<Result<void>> {
		const trimmed = key?.trim() ?? null;
		if (trimmed === null || trimmed === "") {
			const removed = await this.#deps.keychain.delete(LINEAR_API_KEY_KEYCHAIN_KEY);
			if (!removed.ok) return err(keychainError(removed.error.message));
			this.#clear("not_connected");
			return ok(undefined);
		}
		const saved = await this.#deps.keychain.set(LINEAR_API_KEY_KEYCHAIN_KEY, trimmed);
		if (!saved.ok) return err(keychainError(saved.error.message));
		this.#clear("unknown");
		const checked = await this.checkAccess();
		return checked.ok ? ok(undefined) : err(checked.error);
	}

	/** Reads the viewer, so the Account page can tell a working key from a rejected one. */
	async checkAccess(): Promise<Result<LinearAccount>> {
		const response = await this.#graphql(VIEWER_QUERY, {});
		if (!response.ok) return response;
		const viewer = isRecord(response.value.viewer) ? response.value.viewer : null;
		if (viewer === null) return invalidResponse("the viewer is missing");
		const name = text(viewer.name, "the viewer name");
		if (!name.ok) return name;
		const organization = isRecord(viewer.organization)
			? optionalText(viewer.organization.name)
			: null;
		const account = { name: name.value, organization };
		this.store.setState({ connection: "connected", account });
		return ok(account);
	}

	async loadMyIssues(): Promise<Result<LinearIssue[]>> {
		const ticket = this.#issueReads.begin("myIssues");
		const cacheKey = "myActive";
		const cached = this.#readCache<LinearIssue[]>(cacheKey, LINEAR_MY_ISSUES_CACHE_MS);
		if (cached !== undefined) {
			if (this.#issueReads.isLatest(ticket)) {
				this.#issueReads.settle(ticket);
				this.store.setState((state) => ({ ...state, myIssues: cached }));
			}
			return ok(cached);
		}
		const response = await this.#graphql(MY_ACTIVE_ISSUES_QUERY, {});
		if (!response.ok) {
			this.#issueReads.settle(ticket);
			return response;
		}
		const viewer = isRecord(response.value.viewer) ? response.value.viewer : null;
		if (viewer === null) {
			this.#issueReads.settle(ticket);
			return invalidResponse("the viewer is missing");
		}
		const parsed = parseIssueList(viewer.assignedIssues);
		if (!parsed.ok) {
			this.#issueReads.settle(ticket);
			return parsed;
		}
		this.#writeCache(cacheKey, parsed.value);
		if (this.#issueReads.isLatest(ticket)) {
			this.#issueReads.settle(ticket);
			this.store.setState((state) => ({ ...state, myIssues: parsed.value }));
		}
		return ok(parsed.value);
	}

	/** Searches by title or identifier. An identifier also runs the by-id query, as Conductor does. */
	async search(term: string): Promise<Result<LinearIssue[]>> {
		const trimmed = term.trim();
		if (trimmed === "") return this.loadMyIssues();
		if (!LINEAR_IDENTIFIER_REGEX.test(trimmed)) return this.#searchTerm(trimmed);
		// Conductor runs both queries for an identifier, so the exact issue arrives even when the
		// search text matches other issues too.
		const [search, byId] = await Promise.all([this.#searchTerm(trimmed), this.#fetchById(trimmed)]);
		if (!search.ok) return search;
		if (!byId.ok) return byId;
		const found = byId.value === null ? [] : [byId.value];
		const seen = new Set(found.map((issue) => issue.id));
		return ok([...found, ...search.value.filter((issue) => !seen.has(issue.id))]);
	}

	/** Fetches one issue by its Linear id or identifier. */
	async getIssue(idOrIdentifier: string): Promise<Result<LinearIssue>> {
		const found = await this.#fetchById(idOrIdentifier.trim());
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("linear_issue_not_found", "Linear has no issue with that identifier."));
		}
		return ok(found.value);
	}

	/** The teams the viewer belongs to, for the search filter. */
	async teamIds(): Promise<Result<string[]>> {
		const cached = this.#readCache<string[]>("teamIds", LINEAR_TEAM_CACHE_MS);
		if (cached !== undefined) return ok(cached);
		const response = await this.#graphql(TEAM_IDS_QUERY, {});
		if (!response.ok) return response;
		const viewer = isRecord(response.value.viewer) ? response.value.viewer : null;
		if (viewer === null) return invalidResponse("the viewer is missing");
		const teams = connectionNodes(viewer.teams);
		if (!teams.ok) return teams;
		const ids: string[] = [];
		for (const team of teams.value) {
			if (!isRecord(team)) return invalidResponse("a team is not an object");
			const id = text(team.id, "a team id");
			if (!id.ok) return id;
			ids.push(id.value);
		}
		this.#writeCache("teamIds", ids);
		return ok(ids);
	}

	/** Asks Linear which of the given repositories fits an issue (services-map.md 5B.8.1). */
	async suggestRepositories(
		issueId: string,
		candidateRepositories: readonly string[],
	): Promise<Result<RepositorySuggestion[]>> {
		const cacheKey = `suggestions:${issueId}:${candidateRepositories.join(",")}`;
		const cached = this.#readCache<RepositorySuggestion[]>(cacheKey, LINEAR_TEAM_CACHE_MS);
		if (cached !== undefined) return ok(cached);
		const response = await this.#graphql(REPOSITORY_SUGGESTIONS_QUERY, {
			issueId,
			candidateRepositories,
		});
		if (!response.ok) return response;
		const raw = response.value.issueRepositorySuggestions;
		if (!Array.isArray(raw)) return invalidResponse("the repository suggestions are missing");
		const suggestions: RepositorySuggestion[] = [];
		for (const item of raw) {
			if (!isRecord(item)) return invalidResponse("a repository suggestion is not an object");
			const repositoryFullName = text(item.repositoryFullName, "a repository name");
			if (!repositoryFullName.ok) return repositoryFullName;
			const confidence = item.confidence;
			if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
				return invalidResponse("a repository confidence is missing");
			}
			suggestions.push({
				repositoryFullName: repositoryFullName.value,
				confidence,
			});
		}
		this.#writeCache(cacheKey, suggestions);
		return ok(suggestions);
	}

	/** Writes the context file for an issue into a workspace and returns its path. */
	async attachAsContext(issue: LinearIssue, workspacePath: string): Promise<Result<string>> {
		const relativePath = linearIssueContextPath(issue);
		const root = workspacePath.replace(/\/+$/, "");
		if (root === "") {
			return err(appError("linear_workspace_missing", "That workspace has no folder."));
		}
		const absolute = `${root}/${relativePath}`;
		const slash = absolute.lastIndexOf("/");
		const made = await this.#deps.fs.mkdirp(absolute.slice(0, slash));
		if (!made.ok) return made;
		const written = await this.#deps.fs.writeTextAtomic(absolute, linearIssueContextFile(issue));
		if (!written.ok) return written;
		return ok(relativePath);
	}

	/** Backs `Actions.issues.attachToWorkspace` for Linear issues. Returns the file path. */
	async attachToWorkspace(workspaceId: WorkspaceId, issueId: string): Promise<Result<string>> {
		const path = await this.#deps.workspacePathOf(workspaceId);
		if (!path.ok) return path;
		const issue = await this.getIssue(issueId);
		if (!issue.ok) return issue;
		return this.attachAsContext(issue.value, path.value);
	}

	async #searchTerm(term: string): Promise<Result<LinearIssue[]>> {
		const cacheKey = `search:${term}`;
		const cached = this.#readCache<LinearIssue[]>(cacheKey, LINEAR_SEARCH_CACHE_MS);
		if (cached !== undefined) return ok(cached);
		const response = await this.#graphql(SEARCH_ISSUES_QUERY, { term });
		if (!response.ok) return response;
		const parsed = parseIssueList(response.value.searchIssues);
		if (!parsed.ok) return parsed;
		this.#writeCache(cacheKey, parsed.value);
		return parsed;
	}

	async #fetchById(id: string): Promise<Result<LinearIssue | null>> {
		const cacheKey = `byId:${id}`;
		const cached = this.#readCache<LinearIssue | null>(cacheKey, LINEAR_BY_ID_CACHE_MS);
		if (cached !== undefined) return ok(cached);
		const response = await this.#graphql(ISSUE_BY_ID_QUERY, { id });
		if (!response.ok) return response;
		if (response.value.issue === null || response.value.issue === undefined) {
			this.#writeCache(cacheKey, null);
			return ok(null);
		}
		const parsed = parseLinearIssue(response.value.issue);
		if (!parsed.ok) return parsed;
		this.#writeCache(cacheKey, parsed.value);
		return ok(parsed.value);
	}

	async #graphql(
		query: string,
		variables: Record<string, unknown>,
	): Promise<Result<Record<string, unknown>>> {
		const state = this.store.getState();
		if (state.connection === "key_rejected") return err(keyRejectedError());
		const ticket = this.#connectionWrites.begin("connection");
		const key = await this.#readKey();
		if (!key.ok) {
			this.#connectionWrites.settle(ticket);
			return key;
		}
		if (key.value === null) {
			if (this.#connectionWrites.isLatest(ticket)) {
				this.#connectionWrites.settle(ticket);
				this.store.setState((current) => ({
					...current,
					connection: "not_connected",
					account: null,
				}));
			}
			return err(notConnectedError());
		}
		const response = await this.#deps.http.postJson(
			LINEAR_GRAPHQL_URL,
			{ Authorization: key.value, "Content-Type": "application/json" },
			{ query, variables },
		);
		if (!response.ok) {
			this.#connectionWrites.settle(ticket);
			return response;
		}
		if (response.value.status === 401) {
			if (this.#connectionWrites.isLatest(ticket)) {
				this.#connectionWrites.settle(ticket);
				this.#clear("key_rejected");
			}
			return err(keyRejectedError());
		}
		if (response.value.status < 200 || response.value.status >= 300) {
			this.#connectionWrites.settle(ticket);
			return err(
				appError("linear_request_failed", `Linear answered with HTTP ${response.value.status}.`),
			);
		}
		const body = response.value.json;
		if (!isRecord(body)) {
			this.#connectionWrites.settle(ticket);
			return invalidResponse("the answer is not an object");
		}
		const errors = body.errors;
		if (Array.isArray(errors) && errors.length > 0) {
			const first = errors[0];
			const message =
				isRecord(first) && typeof first.message === "string"
					? first.message
					: "the query was refused";
			this.#connectionWrites.settle(ticket);
			return err(appError("linear_graphql_error", `Linear could not answer: ${message}.`));
		}
		if (!isRecord(body.data)) {
			this.#connectionWrites.settle(ticket);
			return invalidResponse("the answer has no data");
		}
		if (this.#connectionWrites.isLatest(ticket)) {
			this.#connectionWrites.settle(ticket);
			this.store.setState((current) => ({ ...current, connection: "connected" }));
		}
		return ok(body.data);
	}

	async #readKey(): Promise<Result<string | null>> {
		const read = await this.#deps.keychain.get(LINEAR_API_KEY_KEYCHAIN_KEY);
		if (!read.ok) return err(keychainError(read.error.message));
		const value = read.value?.trim() ?? "";
		return ok(value === "" ? null : value);
	}

	#clear(connection: LinearConnection): void {
		this.#cache.clear();
		this.store.setState({ connection, myIssues: [], account: null });
	}

	#readCache<T>(key: string, lifetimeMs: number): T | undefined {
		const entry = this.#cache.get(key);
		if (entry === undefined) return undefined;
		if (this.#deps.now() - entry.at >= lifetimeMs) {
			this.#cache.delete(key);
			return undefined;
		}
		return entry.value as T;
	}

	#writeCache(key: string, value: unknown): void {
		this.#cache.set(key, { at: this.#deps.now(), value });
	}
}

function keychainError(message: string) {
	return appError(
		"linear_keychain_unavailable",
		`The Linear key could not be read from the Keychain: ${message}`,
	);
}
