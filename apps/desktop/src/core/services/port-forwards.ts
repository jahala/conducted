/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: the rules around a cloud workspace's port forwards: the Start forwarding switch, the
 * per-forward toggle, adding a typed remote port, moving a forward up or down, automatic
 * forwarding of discovered ports, the exclusive mode, allocation, and stopping everything when a
 * workspace is archived or the app starts with stale rows.
 * Behaviour: docs/research/conductor/services-map.md 5A.3.3 (strategy, local range, mappings,
 * exclusive mode, discovery reconciliation, archive and startup cleanup) and ui-map.md 3.7, 6
 * (the Forward ports popover, Cmd+Y, and the Connections settings). The local listener itself is
 * Rust's (port_forward.rs); this service decides what should be listening.
 * Must handle: a port that is not a number or is outside 1..65535; port 22; a duplicate remote
 * port; a move past either end of the list (nothing changes); a bind failure retried up to five
 * times with a new local port; exclusive mode turning off
 * every other cloud workspace before it turns this one on; an auto-detected port that disappears
 * (stopped and removed), while a port the user turned off stays; one discovery answer never
 * replacing a newer one; a discovery call to an unpaired Mac reported as the workspace's error and
 * never thrown; and a stop that leaves the database row in place for the per-forward switch.
 * Our design choice: the store holds the whole view per workspace, so the Ports tab renders
 * without a second query. Discovery polls the sandbox's `/ports` route every three seconds while a
 * workspace forwards, because our Worker has no push channel for listening ports (D002, D110).
 * Test first: adding port 22 returns `port_forward_reserved`, and a typed 70000 is refused before
 * any Platform call.
 */
import { type AppError, appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Platform } from "../../platform/platform.ts";
import type { DetectedRemotePort, PortForwardEntry, PortForwardView } from "../api.ts";
import {
	type ForwardingStrategy,
	INVALID_PORT_MESSAGE,
	isForwardablePort,
	parseMappings,
	planLocalPort,
	RESERVED_PORT_MESSAGE,
	SSH_PORT,
} from "../cloud/port-allocation.ts";
import type { PortForward, PortForwardRepository } from "../db/port-forwards.ts";
import type { Workspace } from "../model.ts";

/** How often a forwarding workspace's listening ports are read. */
export const DISCOVERY_INTERVAL_MS = 3_000;
/** Conductor's retry count after "Failed to bind port". */
export const BIND_RETRIES = 5;

export interface PortForwardsState {
	byWorkspace: Record<string, PortForwardView>;
}

const EMPTY_VIEW: PortForwardView = Object.freeze({
	forwardingEnabled: false,
	autoForwardEnabled: false,
	waiting: false,
	forwards: [],
	detectedPorts: [],
	error: null,
});

export interface PortForwardsDeps {
	platform: Pick<Platform, "portForward" | "cloud">;
	repos: Pick<{ portForwards: PortForwardRepository }, "portForwards"> & {
		workspaces: {
			get(id: WorkspaceId): Promise<Result<Workspace | null>>;
			listAll(): Promise<Result<Workspace[]>>;
		};
	};
	settings: { get<T>(key: string): T };
}

export function viewOf(forward: PortForward): PortForwardEntry {
	return {
		id: forward.id,
		remotePort: forward.remotePort,
		localPort: forward.localPort,
		label: forward.label,
		autoDetected: forward.autoDetected,
		enabled: forward.enabled,
		position: forward.position,
	};
}

function viewWith(
	view: PortForwardView | undefined,
	patch: Partial<PortForwardView>,
): PortForwardView {
	return { ...(view ?? EMPTY_VIEW), ...patch };
}

/** The place a new forward takes: after every forward the workspace already has. */
function nextPosition(forwards: readonly PortForwardEntry[]): number {
	return forwards.reduce((highest, forward) => Math.max(highest, forward.position), -1) + 1;
}

function errorCode(error: AppError): string {
	return error.code;
}

export class PortForwardsService {
	readonly store: StoreApi<PortForwardsState>;
	readonly #deps: PortForwardsDeps;
	/** One allocation at a time across the machine, as Conductor's named serial queue. */
	#queue: Promise<unknown> = Promise.resolve();
	readonly #discovery = new Map<string, ReturnType<typeof setInterval>>();
	readonly #discovering = new Map<string, Promise<Result<void>>>();
	#unsubscribeEvents: (() => void) | null = null;

	constructor(deps: PortForwardsDeps) {
		this.#deps = deps;
		this.store = createStore<PortForwardsState>(() => ({ byWorkspace: {} }));
	}

	#serial<T>(work: () => Promise<T>): Promise<T> {
		const next = this.#queue.then(work, work);
		this.#queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	async start(): Promise<Result<void>> {
		const cleaned = await this.#deps.repos.portForwards.removeArchivedOrMissing();
		if (!cleaned.ok) return cleaned;
		const all = await this.#deps.repos.portForwards.listAll();
		if (!all.ok) return all;
		const workspaces = await this.#deps.repos.workspaces.listAll();
		if (!workspaces.ok) return workspaces;
		const byWorkspace: Record<string, PortForwardView> = {};
		for (const workspace of workspaces.value) {
			if (workspace.host.kind === "cloud") byWorkspace[workspace.id] = { ...EMPTY_VIEW };
		}
		for (const forward of all.value) {
			const current = byWorkspace[forward.workspaceId] ?? EMPTY_VIEW;
			byWorkspace[forward.workspaceId] = {
				...current,
				forwards: [...current.forwards, viewOf(forward)],
			};
		}
		for (const workspaceId of Object.keys(byWorkspace)) {
			const flags = await this.#deps.repos.portForwards.flags(workspaceId as WorkspaceId);
			if (!flags.ok) continue;
			byWorkspace[workspaceId] = viewWith(byWorkspace[workspaceId], {
				forwardingEnabled: flags.value.forwardingEnabled,
				autoForwardEnabled: flags.value.autoForwardEnabled,
			});
		}
		this.store.setState({ byWorkspace });
		this.#unsubscribeEvents?.();
		this.#unsubscribeEvents = this.#deps.platform.portForward.onEvent((event) => {
			for (const [workspaceId, view] of Object.entries(this.store.getState().byWorkspace)) {
				if (!view.forwards.some((forward) => forward.id === event.forwardId)) continue;
				if (event.kind === "error") {
					this.#patch(workspaceId as WorkspaceId, {
						error: event.message ?? "Port forwarding failed.",
					});
				}
			}
		});
		// The switch survives a restart, so the forwards it left on are started again, as Conductor
		// does at startup. A workspace whose sandbox or key is unavailable keeps its rows and shows
		// the error instead of losing the user's forwards.
		for (const workspace of workspaces.value) {
			if (workspace.host.kind !== "cloud") continue;
			if (!this.view(workspace.id).forwardingEnabled) continue;
			const taken = await this.#taken();
			if (!taken.ok) continue;
			for (const forward of this.view(workspace.id).forwards) {
				if (!forward.enabled) continue;
				const row = await this.#deps.repos.portForwards.get(forward.id);
				if (!row.ok || row.value === null) continue;
				const started = await this.#start(workspace, row.value, taken.value);
				if (!started.ok) this.#patch(workspace.id, { error: started.error.message });
				else taken.value.add(started.value.localPort);
			}
			this.#startDiscovery(workspace.id);
		}
		return ok(undefined);
	}

	stop(): void {
		for (const timer of this.#discovery.values()) clearInterval(timer);
		this.#discovery.clear();
		this.#unsubscribeEvents?.();
		this.#unsubscribeEvents = null;
	}

	view(workspaceId: WorkspaceId): PortForwardView {
		return this.store.getState().byWorkspace[workspaceId] ?? EMPTY_VIEW;
	}

	async #workspace(workspaceId: WorkspaceId): Promise<Result<Workspace>> {
		const read = await this.#deps.repos.workspaces.get(workspaceId);
		if (!read.ok) return read;
		if (read.value === null) {
			return err(appError("workspace_unknown", "That workspace no longer exists."));
		}
		if (read.value.host.kind !== "cloud") {
			return err(appError("port_forward_local", "Port forwarding is for cloud workspaces only."));
		}
		return ok(read.value);
	}

	#patch(workspaceId: WorkspaceId, patch: Partial<PortForwardView>): void {
		this.store.setState((state) => ({
			byWorkspace: {
				...state.byWorkspace,
				[workspaceId]: viewWith(state.byWorkspace[workspaceId], patch),
			},
		}));
	}

	#taken(): Promise<Result<Set<number>>> {
		return this.#deps.repos.portForwards
			.localPorts()
			.then((ports) => (ports.ok ? ok(new Set(ports.value)) : err(ports.error)));
	}

	#range(): { start: number; end: number } {
		return {
			start: this.#deps.settings.get<number>("local_port_range_start"),
			end: this.#deps.settings.get<number>("local_port_range_end"),
		};
	}

	#strategy(): ForwardingStrategy {
		return this.#deps.settings.get<ForwardingStrategy>("port_forwarding_strategy");
	}

	#mappings() {
		return parseMappings(this.#deps.settings.get<string[]>("port_mappings"));
	}

	async #choosePort(
		workspace: Workspace,
		remotePort: number,
		taken: Set<number>,
	): Promise<Result<number>> {
		const range = this.#range();
		const plan = planLocalPort({
			remotePort,
			workspaceKey: workspace.id,
			strategy: this.#strategy(),
			range,
			mappings: this.#mappings(),
			taken,
		});
		if (!plan.ok) return plan;
		const found = await this.#deps.platform.portForward.findAvailableLocalPort({
			preferredPort: plan.value.preferredPort,
			excludedPorts: [...taken],
			rangeStart: range.start,
			rangeEnd: range.end,
		});
		if (!found.ok) return found;
		// A manual mapping is fixed: never let the search move it silently.
		if (plan.value.pinned && found.value !== plan.value.preferredPort) {
			return err(
				appError(
					"port_forward_mapping_taken",
					`Local port ${plan.value.preferredPort ?? 0} is mapped to remote port ${remotePort} but is already in use`,
				),
			);
		}
		return ok(found.value);
	}

	async #start(
		workspace: Workspace,
		forward: PortForward,
		taken: Set<number>,
	): Promise<Result<PortForward>> {
		if (workspace.host.kind !== "cloud") {
			return err(appError("port_forward_local", "Port forwarding is for cloud workspaces only."));
		}
		let row = forward;
		for (let attempt = 0; attempt <= BIND_RETRIES; attempt += 1) {
			const started = await this.#deps.platform.portForward.start({
				forwardId: row.id,
				url: workspace.host.url,
				vmId: workspace.host.vmId,
				localPort: row.localPort,
				remotePort: row.remotePort,
			});
			if (started.ok) {
				const view = this.view(workspace.id);
				this.#patch(workspace.id, {
					forwards: view.forwards.map((forward) =>
						forward.id === row.id ? { ...forward, localPort: row.localPort } : forward,
					),
				});
				return ok(row);
			}
			if (errorCode(started.error) !== "port_forward_bind_failed" || attempt === BIND_RETRIES) {
				return err(started.error);
			}
			taken.add(row.localPort);
			const choice = await this.#choosePort(workspace, row.remotePort, taken);
			if (!choice.ok) return choice;
			const moved = await this.#deps.repos.portForwards.setLocalPort(row.id, choice.value);
			if (!moved.ok) return moved;
			row = { ...row, localPort: choice.value };
			taken.add(choice.value);
		}
		return err(appError("port_forward_bind_failed", "Failed to bind a local port."));
	}

	setForwarding(workspaceId: WorkspaceId, enabled: boolean): Promise<Result<void>> {
		return this.#serial(() => this.#setForwarding(workspaceId, enabled));
	}

	async #setForwarding(workspaceId: WorkspaceId, enabled: boolean): Promise<Result<void>> {
		const workspace = await this.#workspace(workspaceId);
		if (!workspace.ok) return workspace;
		if (enabled && this.#deps.settings.get<boolean>("exclusive_port_forwarding_enabled")) {
			for (const [otherId, view] of Object.entries(this.store.getState().byWorkspace)) {
				if (otherId === workspaceId || !view.forwardingEnabled) continue;
				await this.#setForwarding(otherId as WorkspaceId, false);
			}
		}
		const saved = await this.#deps.repos.portForwards.setForwardingEnabled(workspaceId, enabled);
		if (!saved.ok) return saved;
		this.#patch(workspaceId, { forwardingEnabled: enabled, error: null });
		if (!enabled) {
			await this.#stopAll(workspaceId);
			this.#stopDiscovery(workspaceId);
			this.#patch(workspaceId, { waiting: false });
			return ok(undefined);
		}
		const taken = await this.#taken();
		if (!taken.ok) return taken;
		const view = this.view(workspaceId);
		for (const forward of view.forwards) {
			if (!forward.enabled) continue;
			const row = await this.#deps.repos.portForwards.get(forward.id);
			if (!row.ok || row.value === null) continue;
			const started = await this.#start(workspace.value, row.value, taken.value);
			if (!started.ok) {
				this.#patch(workspaceId, { error: started.error.message });
				continue;
			}
			taken.value.add(started.value.localPort);
		}
		this.#patch(workspaceId, { waiting: view.detectedPorts.length === 0 });
		this.#startDiscovery(workspaceId);
		return ok(undefined);
	}

	async setAutoForward(workspaceId: WorkspaceId, enabled: boolean): Promise<Result<void>> {
		return this.#serial(async () => {
			const saved = await this.#deps.repos.portForwards.setAutoForwardEnabled(workspaceId, enabled);
			if (!saved.ok) return saved;
			this.#patch(workspaceId, { autoForwardEnabled: enabled });
			if (enabled && this.view(workspaceId).forwardingEnabled) {
				await this.refreshDiscovery(workspaceId);
			}
			return ok(undefined);
		});
	}

	async add(workspaceId: WorkspaceId, remotePort: number): Promise<Result<PortForwardEntry>> {
		return this.#serial(async () => {
			if (!isForwardablePort(remotePort)) {
				return err(appError("port_forward_invalid", INVALID_PORT_MESSAGE));
			}
			if (remotePort === SSH_PORT) {
				return err(appError("port_forward_reserved", RESERVED_PORT_MESSAGE));
			}
			const workspace = await this.#workspace(workspaceId);
			if (!workspace.ok) return workspace;
			const view = this.view(workspaceId);
			if (view.forwards.some((forward) => forward.remotePort === remotePort)) {
				return err(appError("port_forward_duplicate", `Port ${remotePort} is already forwarded.`));
			}
			const taken = await this.#taken();
			if (!taken.ok) return taken;
			const localPort = await this.#choosePort(workspace.value, remotePort, taken.value);
			if (!localPort.ok) return localPort;
			const added = await this.#deps.repos.portForwards.add({
				workspaceId,
				remotePort,
				localPort: localPort.value,
				label: null,
				autoDetected: false,
				enabled: true,
				position: nextPosition(view.forwards),
			});
			if (!added.ok) return added;
			this.#patch(workspaceId, { forwards: [...view.forwards, viewOf(added.value)] });
			if (view.forwardingEnabled) {
				const started = await this.#start(workspace.value, added.value, taken.value);
				if (!started.ok) {
					this.#patch(workspaceId, { error: started.error.message });
					return err(started.error);
				}
			}
			return ok(viewOf(added.value));
		});
	}

	async remove(forwardId: string): Promise<Result<void>> {
		return this.#serial(async () => {
			const found = this.#find(forwardId);
			if (found === null) return ok(undefined);
			await this.#deps.platform.portForward.stop(forwardId);
			const deleted = await this.#deps.repos.portForwards.delete(forwardId);
			if (!deleted.ok) return deleted;
			const view = this.view(found.workspaceId);
			this.#patch(found.workspaceId, {
				forwards: view.forwards.filter((forward) => forward.id !== forwardId),
			});
			return ok(undefined);
		});
	}

	/**
	 * Moves one forward up or down in its workspace's list. The list's positions are rewritten
	 * from zero, so removals leave no gaps behind. A move past either end changes nothing.
	 */
	async move(forwardId: string, direction: "up" | "down"): Promise<Result<void>> {
		return this.#serial(async () => {
			const found = this.#find(forwardId);
			if (found === null) return ok(undefined);
			const view = this.view(found.workspaceId);
			const index = view.forwards.findIndex((forward) => forward.id === forwardId);
			const target = direction === "up" ? index - 1 : index + 1;
			if (index === -1 || target < 0 || target >= view.forwards.length) return ok(undefined);
			const next = [...view.forwards];
			const [moved] = next.splice(index, 1);
			if (moved === undefined) return ok(undefined);
			next.splice(target, 0, moved);
			for (const [position, forward] of next.entries()) {
				const saved = await this.#deps.repos.portForwards.setPosition(forward.id, position);
				if (!saved.ok) return saved;
			}
			this.#patch(found.workspaceId, {
				forwards: next.map((forward, position) => ({ ...forward, position })),
			});
			return ok(undefined);
		});
	}

	async toggle(forwardId: string, enabled: boolean): Promise<Result<void>> {
		return this.#serial(async () => {
			const found = this.#find(forwardId);
			if (found === null) return ok(undefined);
			const saved = await this.#deps.repos.portForwards.setEnabled(forwardId, enabled);
			if (!saved.ok) return saved;
			const view = this.view(found.workspaceId);
			this.#patch(found.workspaceId, {
				forwards: view.forwards.map((forward) =>
					forward.id === forwardId ? { ...forward, enabled } : forward,
				),
			});
			if (!enabled) {
				await this.#deps.platform.portForward.stop(forwardId);
				return ok(undefined);
			}
			const workspace = await this.#workspace(found.workspaceId);
			if (!workspace.ok) return workspace;
			const row = await this.#deps.repos.portForwards.get(forwardId);
			if (!row.ok || row.value === null) return ok(undefined);
			const taken = await this.#taken();
			if (!taken.ok) return taken;
			const started = await this.#start(workspace.value, row.value, taken.value);
			return started.ok ? ok(undefined) : err(started.error);
		});
	}

	async pauseWorkspace(workspaceId: WorkspaceId): Promise<Result<void>> {
		return this.#serial(async () => {
			await this.#deps.repos.portForwards.setForwardingEnabled(workspaceId, false);
			await this.#deps.repos.portForwards.setAutoForwardEnabled(workspaceId, false);
			await this.#stopAll(workspaceId);
			this.#stopDiscovery(workspaceId);
			const deleted = await this.#deps.repos.portForwards.deleteForWorkspace(workspaceId);
			if (!deleted.ok) return deleted;
			this.#patch(workspaceId, {
				forwardingEnabled: false,
				autoForwardEnabled: false,
				waiting: false,
				forwards: [],
				detectedPorts: [],
			});
			return ok(undefined);
		});
	}

	refreshDiscovery(workspaceId: WorkspaceId): Promise<Result<void>> {
		// A caller that arrives during a read joins it, so the answer it sees is the newest one.
		const running = this.#discovering.get(workspaceId);
		if (running !== undefined) return running;
		const read = this.#readDiscovery(workspaceId);
		this.#discovering.set(workspaceId, read);
		void read.finally(() => {
			if (this.#discovering.get(workspaceId) === read) this.#discovering.delete(workspaceId);
		});
		return read;
	}

	async #readDiscovery(workspaceId: WorkspaceId): Promise<Result<void>> {
		const workspace = await this.#workspace(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") return ok(undefined);
		const host = workspace.value.host;
		const response = await this.#deps.platform.cloud.request({
			url: host.url,
			method: "GET",
			path: `/w/${host.vmId}/ports`,
		});
		if (!response.ok) {
			this.#patch(workspaceId, { error: response.error.message });
			return err(response.error);
		}
		if (response.value.status !== 200) {
			const failure = appError(
				"port_forward_discovery_failed",
				`The sandbox answered ${response.value.status} when asked for its ports.`,
			);
			this.#patch(workspaceId, { error: failure.message });
			return err(failure);
		}
		let ports: DetectedRemotePort[] = [];
		try {
			const parsed = JSON.parse(response.value.body) as { ports?: unknown };
			if (Array.isArray(parsed.ports)) {
				const byPort = new Map<number, DetectedRemotePort>();
				for (const entry of parsed.ports) {
					if (typeof entry !== "object" || entry === null) continue;
					const port = (entry as { port?: unknown }).port;
					const name = (entry as { processName?: unknown }).processName;
					if (typeof port !== "number" || !Number.isInteger(port)) continue;
					if (port < 1024 || port > 65_535 || port === SSH_PORT) continue;
					byPort.set(port, {
						port,
						processName: typeof name === "string" && name !== "" ? name : null,
					});
				}
				ports = [...byPort.values()];
			}
		} catch {
			// A body that is not the discovery shape leaves the previous answer in place.
			return ok(undefined);
		}
		this.#patch(workspaceId, {
			detectedPorts: ports.sort((left, right) => left.port - right.port),
			waiting: false,
			error: null,
		});
		await this.#reconcile(workspace.value, ports);
		return ok(undefined);
	}

	/** The Worker's capability URL for one remote port's preview. */
	async previewUrl(workspaceId: WorkspaceId, remotePort: number): Promise<Result<string>> {
		const workspace = await this.#workspace(workspaceId);
		if (!workspace.ok) return workspace;
		if (workspace.value.host.kind !== "cloud") {
			return err(appError("port_forward_local", "Port forwarding is for cloud workspaces only."));
		}
		if (remotePort === SSH_PORT) {
			return err(appError("port_forward_reserved", RESERVED_PORT_MESSAGE));
		}
		const host = workspace.value.host;
		const response = await this.#deps.platform.cloud.request({
			url: host.url,
			method: "POST",
			path: `/w/${host.vmId}/preview-url`,
			body: { port: remotePort },
		});
		if (!response.ok) return err(response.error);
		if (response.value.status !== 200) {
			return err(
				appError(
					"port_forward_preview_failed",
					`The sandbox answered ${response.value.status} when asked for a preview URL.`,
				),
			);
		}
		try {
			const parsed = JSON.parse(response.value.body) as { url?: unknown };
			if (typeof parsed.url === "string" && parsed.url !== "") return ok(parsed.url);
		} catch {
			// Fall through to the error below.
		}
		return err(
			appError("port_forward_preview_failed", "The Worker did not answer with a preview URL."),
		);
	}

	async #reconcile(workspace: Workspace, ports: readonly DetectedRemotePort[]): Promise<void> {
		const view = this.view(workspace.id);
		if (!view.forwardingEnabled || !view.autoForwardEnabled) return;
		const live = new Set(ports.map((entry) => entry.port));
		for (const forward of view.forwards) {
			if (!forward.autoDetected || live.has(forward.remotePort)) continue;
			await this.#deps.platform.portForward.stop(forward.id);
			await this.#deps.repos.portForwards.delete(forward.id);
			const current = this.view(workspace.id);
			this.#patch(workspace.id, {
				forwards: current.forwards.filter((entry) => entry.id !== forward.id),
			});
		}
		const taken = await this.#taken();
		if (!taken.ok) return;
		for (const detected of ports) {
			const remotePort = detected.port;
			const current = this.view(workspace.id);
			if (current.forwards.some((forward) => forward.remotePort === remotePort)) continue;
			const localPort = await this.#choosePort(workspace, remotePort, taken.value);
			if (!localPort.ok) continue;
			const added = await this.#deps.repos.portForwards.add({
				workspaceId: workspace.id,
				remotePort,
				localPort: localPort.value,
				label: null,
				autoDetected: true,
				enabled: true,
				position: nextPosition(current.forwards),
			});
			if (!added.ok) continue;
			taken.value.add(added.value.localPort);
			this.#patch(workspace.id, {
				forwards: [...this.view(workspace.id).forwards, viewOf(added.value)],
			});
			await this.#start(workspace, added.value, taken.value);
		}
	}

	#find(forwardId: string): { workspaceId: WorkspaceId; forward: PortForwardEntry } | null {
		for (const [workspaceId, view] of Object.entries(this.store.getState().byWorkspace)) {
			const forward = view.forwards.find((entry) => entry.id === forwardId);
			if (forward !== undefined) return { workspaceId: workspaceId as WorkspaceId, forward };
		}
		return null;
	}

	async #stopAll(workspaceId: WorkspaceId): Promise<void> {
		for (const forward of this.view(workspaceId).forwards) {
			await this.#deps.platform.portForward.stop(forward.id);
		}
	}

	#startDiscovery(workspaceId: WorkspaceId): void {
		this.#stopDiscovery(workspaceId);
		void this.refreshDiscovery(workspaceId);
		const timer = setInterval(() => {
			void this.refreshDiscovery(workspaceId);
		}, DISCOVERY_INTERVAL_MS);
		this.#discovery.set(workspaceId, timer);
	}

	#stopDiscovery(workspaceId: WorkspaceId): void {
		const timer = this.#discovery.get(workspaceId);
		if (timer !== undefined) clearInterval(timer);
		this.#discovery.delete(workspaceId);
	}
}
