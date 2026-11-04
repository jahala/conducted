/**
 * @feature PR-09 Linear issues: list, search, attach as context
 * Owns: asking Linear for the user's issues and turning a chosen issue into a context file for a
 * new workspace.
 * Behaviour: services-map.md 5B.8.1 (queries: my active issues, search, by identifier, team
 * ids), 5B.8.3 (an issue becomes a file `.context/attachments/<key>/[LINEAR]-<id>.md`).
 * Must handle: no key stored (state "not connected", no request); a 401 answer (state "key
 * rejected", do not retry with the same key); an identifier like `ABC-123` runs the by-id query
 * and the search together; results are cached for 15 seconds (lists) and 60 seconds (by id);
 * the key never reaches a log; only the newest search wins.
 * Our design choice: the user pastes a personal Linear API key, stored in the Keychain. There is
 * no OAuth because there is no backend. The platform has no HTTP group, so requests go through
 * `LinearHttp`, which the container fills (see `createCurlLinearHttp`). Proposed contract
 * change: a `Platform.http` group would replace the curl adapter.
 * Test first: a 401 moves the state to "key rejected" and a second call makes no request.
 */
import { notImplemented, type Result } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";

export interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	url: string;
	branchName: string | null;
	state: { name: string; type: string };
	assignee: string | null;
	priorityLabel: string | null;
	labels: string[];
}

export interface LinearHttp {
	/** POSTs JSON and returns the status and parsed JSON body. */
	postJson(
		url: string,
		headers: Readonly<Record<string, string>>,
		body: unknown,
	): Promise<Result<{ status: number; json: unknown }>>;
}

/** Runs `curl` through the shell as the HTTP client. See the design choice above. */
export function createCurlLinearHttp(_shell: Platform["shell"]): LinearHttp {
	return { postJson: () => notImplemented("PR-09") };
}

export type LinearConnection = "unknown" | "not_connected" | "connected" | "key_rejected";

export interface LinearState {
	connection: LinearConnection;
	myIssues: readonly LinearIssue[];
}

export interface LinearServiceDeps {
	http: LinearHttp;
	keychain: Platform["keychain"];
}

export class LinearService {
	readonly store: StoreApi<LinearState>;
	readonly #deps: LinearServiceDeps;

	constructor(deps: LinearServiceDeps) {
		this.#deps = deps;
		this.store = createStore<LinearState>(() => ({ connection: "unknown", myIssues: [] }));
	}

	setApiKey(_key: string): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("PR-09");
	}

	loadMyIssues(): Promise<Result<LinearIssue[]>> {
		return notImplemented("PR-09");
	}

	search(_term: string): Promise<Result<LinearIssue[]>> {
		return notImplemented("PR-09");
	}

	/** Writes the context file for an issue into a workspace and returns its path. */
	attachAsContext(_issue: LinearIssue, _workspacePath: string): Promise<Result<string>> {
		return notImplemented("PR-09");
	}
}
