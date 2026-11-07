/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Owns: the one view the cloud header renders: the workspace's running state, the CPU, memory and
 * disk the sandbox reports, its total recorded agent cost, and the last Worker error. It also
 * polls that view while the header is on screen.
 * Behaviour: ui-map.md 3.1 (status, CPU, memory, disk, "Low disk", "Agent cost"). The Worker's
 * `/state` route is CLOUD-03's; the cost is summed from the workspace's stored usage events, the
 * same values the agent reported for each turn (CHAT-14). Conductor reads both from its hosted
 * backend (`remoteState`); ours come from the sandbox and the local record (D116).
 * Must handle: a local workspace (no Worker call, an empty view); an unpaired Mac, a Worker that is
 * unreachable, or an answer of the wrong shape (the error is shown and the previous status is
 * kept); a stopped sandbox (no resource readings); an older refresh that finishes after a newer one
 * (the older answer is dropped); a workspace that left the store (no view is invented).
 * Our design choice: the service keeps one view per workspace so the header redraws from one
 * subscription, as the Ports tab does. Polling is owned by `watch`, which the header releases on
 * unmount, so no timer outlives the screen. The interval is ours: Conductor's cloud state sync
 * polls its backend, and the research gives no interval (D002).
 * Test first: a cloud workspace's state and cost are read into one view.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { CloudWorkspaceView } from "../api.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import { readCloudWorkspaceState } from "../cloud/lifecycle.ts";
import { type CloudWorkspaceResources, statusOfCloudState } from "../cloud/state.ts";
import type { SessionEventRepository } from "../db/session-events.ts";
import type { WorkspaceRepository } from "../db/workspaces.ts";
import type { Workspace } from "../model.ts";

/** How often the header re-reads a cloud workspace while it is on screen. */
export const CLOUD_STATE_POLL_MS = 10_000;

const EMPTY_RESOURCES: CloudWorkspaceResources = Object.freeze({
	cpu: null,
	memory: null,
	disk: null,
});

export const EMPTY_CLOUD_WORKSPACE_VIEW: CloudWorkspaceView = Object.freeze({
	status: "unknown",
	resources: EMPTY_RESOURCES,
	agentCostUsd: null,
	error: null,
});

export interface CloudWorkspaceState {
	byWorkspace: Record<string, CloudWorkspaceView>;
}

export interface CloudWorkspaceDeps {
	platform: Pick<Platform, "cloud">;
	repos: {
		workspaces: Pick<WorkspaceRepository, "get" | "listAll">;
		sessionEvents: Pick<SessionEventRepository, "workspaceCost">;
	};
}

interface Watch {
	timer: ReturnType<typeof setInterval>;
	/** How many screens hold this workspace's view; the timer stops when the last leaves. */
	holders: number;
}

export class CloudWorkspaceService {
	readonly store: StoreApi<CloudWorkspaceState>;
	readonly #deps: CloudWorkspaceDeps;
	/** Drops a refresh that finished after a newer one for the same workspace. */
	readonly #latest = createLatestWins<string>();
	readonly #watches = new Map<string, Watch>();

	constructor(deps: CloudWorkspaceDeps) {
		this.#deps = deps;
		this.store = createStore<CloudWorkspaceState>(() => ({ byWorkspace: {} }));
	}

	/** Gives every cloud workspace an empty view, so the header never waits for a first read. */
	async start(): Promise<Result<void>> {
		const listed = await this.#deps.repos.workspaces.listAll();
		if (!listed.ok) return listed;
		const byWorkspace: Record<string, CloudWorkspaceView> = {};
		for (const workspace of listed.value) {
			if (workspace.host.kind === "cloud") {
				byWorkspace[workspace.id] = { ...EMPTY_CLOUD_WORKSPACE_VIEW };
			}
		}
		this.store.setState({ byWorkspace });
		return ok(undefined);
	}

	/** Stops every poll. Safe to call twice. */
	stop(): void {
		for (const watch of this.#watches.values()) clearInterval(watch.timer);
		this.#watches.clear();
	}

	view(workspaceId: WorkspaceId): CloudWorkspaceView {
		return this.store.getState().byWorkspace[workspaceId] ?? EMPTY_CLOUD_WORKSPACE_VIEW;
	}

	/**
	 * Polls one workspace while a screen holds it. The first refresh runs now, then every
	 * `CLOUD_STATE_POLL_MS`. The returned function releases this holder; the timer stops with the
	 * last one.
	 */
	watch(workspaceId: WorkspaceId): () => void {
		const existing = this.#watches.get(workspaceId);
		if (existing === undefined) {
			const timer = setInterval(() => {
				void this.refresh(workspaceId);
			}, CLOUD_STATE_POLL_MS);
			this.#watches.set(workspaceId, { timer, holders: 1 });
		} else {
			existing.holders += 1;
		}
		void this.refresh(workspaceId);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			const watch = this.#watches.get(workspaceId);
			if (watch === undefined) return;
			watch.holders -= 1;
			if (watch.holders > 0) return;
			clearInterval(watch.timer);
			this.#watches.delete(workspaceId);
			this.#latest.invalidate(workspaceId);
		};
	}

	/** Reads one workspace's state and cost into its view. A local workspace makes no call. */
	async refresh(workspaceId: WorkspaceId): Promise<Result<CloudWorkspaceView>> {
		const ticket = this.#latest.begin(workspaceId);
		const found = await this.#deps.repos.workspaces.get(workspaceId);
		if (!found.ok) return found;
		if (found.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		const workspace: Workspace = found.value;
		if (workspace.host.kind !== "cloud") return ok(this.view(workspaceId));

		const state = await readCloudWorkspaceState(this.#deps.platform.cloud, workspace.host);
		const cost = await this.#deps.repos.sessionEvents.workspaceCost(workspaceId);
		if (!this.#latest.isLatest(ticket)) return ok(this.view(workspaceId));
		this.#latest.settle(ticket);

		const current = this.view(workspaceId);
		const next: CloudWorkspaceView = state.ok
			? {
					status: statusOfCloudState(state.value),
					resources: state.value.resources ?? EMPTY_RESOURCES,
					agentCostUsd: cost.ok ? cost.value : (current.agentCostUsd ?? null),
					error: null,
				}
			: {
					...current,
					agentCostUsd: cost.ok ? cost.value : (current.agentCostUsd ?? null),
					error: state.error.message,
				};
		this.#patch(workspaceId, next);
		return state.ok ? ok(next) : err(state.error);
	}

	#patch(workspaceId: WorkspaceId, view: CloudWorkspaceView): void {
		this.store.setState((state) => ({
			byWorkspace: { ...state.byWorkspace, [workspaceId]: view },
		}));
	}
}
