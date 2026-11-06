/**
 * @feature NAV-15 Terminals and previews that survive tab switches
 * @feature NAV-01 App shell: the surface layout registry
 * Owns: the surface layout registry the app shell creates (the surfaces on show, where each one's
 * anchor is, and which surface asked for focus); the slots that register a terminal and report its
 * anchor (a centre terminal tab's, and the Scripts panel Run tab's); and the host the shell mounts
 * once, which draws the registry through SurfaceLayer.
 * Behaviour: services-map.md 1.5 (surface layout registry: anchors, surface configs, placements, requested
 * focus surface), ui-map.md 1.1 (a surface layer mounted once at the root keeps terminals alive over
 * anchors) and 8. Conductor's bundle also draws the Run tab's action terminal through this layer (a
 * surface of kind "run" over an anchor in the right panel); its Setup tab draws in place.
 * Our design choice: a terminal is registered the first time its slot is shown, so a terminal nobody
 * looked at starts no view. A tab's terminal stays mounted while it is one of the tabs the strip draws
 * for a workspace that still exists and is not archived (terminalTabs in TabStrip.tsx); once its tab is
 * gone, its registration is removed and its view unmounts. Each workspace has at most one run surface:
 * the Run tab's newest output, which replaces the one before it and stays while the workspace exists and
 * is not archived, so the Run tab shows it again after a workspace switch. A run surface does not take
 * focus. The registry is a store the shell creates for itself, not module state. Browser previews have
 * no surface yet: their tab is RUN-04's placeholder.
 * Must handle: a tab or workspace switch (the anchor unmounts, its placement becomes null, the terminal
 * hides and keeps its scrollback and shell); the slot shown again (the anchor reports its box, the
 * terminal shows, and a tab's terminal takes focus); a tab that leaves the strip, a newer run, or a
 * workspace that is archived or deleted (the terminal unmounts); a terminal list or workspace list that
 * has not loaded yet (the registration waits, nothing is drawn).
 * Test first: over the real container and router, switching from a terminal tab to a chat and back keeps
 * the same terminal element mounted, hidden in between.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useServices } from "../core/context.tsx";
import type { Terminal, Workspace } from "../core/model.ts";
import { TerminalView } from "../features/terminal/TerminalView.tsx";
import { tabRef } from "../features/workspace/active-tab.ts";
import { terminalTabs } from "../features/workspace/TabStrip.tsx";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import {
	SurfaceAnchor,
	SurfaceLayer,
	type SurfaceRect,
	type SurfaceSpec,
	usableRect,
} from "./SurfaceLayer.tsx";

/** One terminal a slot has shown: a centre terminal tab's, or the Run tab's action output. */
export interface TerminalSurfaceConfig {
	surfaceId: string;
	kind: "terminal";
	owner: "tab" | "run";
	workspaceId: WorkspaceId;
	terminalId: TerminalId;
}

export interface SurfaceRegistryState {
	surfaces: readonly TerminalSurfaceConfig[];
	/** Each mounted anchor's box. A surface with no entry hides. */
	placements: ReadonlyMap<string, SurfaceRect>;
	focusSurfaceId: string | null;
}

export interface SurfaceRegistry {
	readonly store: StoreApi<SurfaceRegistryState>;
	/**
	 * A slot shows this surface: register it if it is new. A tab's surface asks for focus; a run
	 * surface replaces the workspace's earlier run surface.
	 */
	show(config: TerminalSurfaceConfig): void;
	/** An anchor moved, resized or unmounted (null). */
	place(surfaceId: string, rect: SurfaceRect | null): void;
	/** Drops every registration whose tab is gone, with its placement. */
	remove(surfaceIds: ReadonlySet<string>): void;
}

const sameRect = (left: SurfaceRect | undefined, right: SurfaceRect | null): boolean =>
	(left === undefined && right === null) ||
	(left !== undefined &&
		right !== null &&
		left.x === right.x &&
		left.y === right.y &&
		left.width === right.width &&
		left.height === right.height);

export function createSurfaceRegistry(): SurfaceRegistry {
	const store = createStore<SurfaceRegistryState>(() => ({
		surfaces: [],
		placements: new Map(),
		focusSurfaceId: null,
	}));
	return {
		store,
		show: (config) =>
			store.setState((state) => {
				if (config.owner === "tab") {
					return {
						surfaces: state.surfaces.some((surface) => surface.surfaceId === config.surfaceId)
							? state.surfaces
							: [...state.surfaces, config],
						focusSurfaceId: config.surfaceId,
					};
				}
				if (state.surfaces.some((surface) => surface.surfaceId === config.surfaceId)) return {};
				// One run surface per workspace: a newer run's output replaces the earlier one.
				const replaced = state.surfaces.filter(
					(surface) => surface.owner === "run" && surface.workspaceId === config.workspaceId,
				);
				const placements = new Map(state.placements);
				for (const surface of replaced) placements.delete(surface.surfaceId);
				return {
					surfaces: [...state.surfaces.filter((surface) => !replaced.includes(surface)), config],
					placements,
				};
			}),
		place: (surfaceId, rect) => {
			const { placements } = store.getState();
			if (sameRect(placements.get(surfaceId), rect)) return;
			const next = new Map(placements);
			// An unmounted anchor leaves no entry, so the map holds only anchors on screen.
			if (rect === null) next.delete(surfaceId);
			else next.set(surfaceId, rect);
			store.setState({ placements: next });
		},
		remove: (surfaceIds) =>
			store.setState((state) => {
				const placements = new Map(state.placements);
				for (const surfaceId of surfaceIds) placements.delete(surfaceId);
				return {
					surfaces: state.surfaces.filter((surface) => !surfaceIds.has(surface.surfaceId)),
					placements,
					focusSurfaceId:
						state.focusSurfaceId !== null && surfaceIds.has(state.focusSurfaceId)
							? null
							: state.focusSurfaceId,
				};
			}),
	};
}

const SurfaceRegistryContext = createContext<SurfaceRegistry | null>(null);

export function SurfaceRegistryProvider({
	registry,
	children,
}: {
	registry: SurfaceRegistry;
	children: ReactNode;
}) {
	return (
		<SurfaceRegistryContext.Provider value={registry}>{children}</SurfaceRegistryContext.Provider>
	);
}

function useSurfaceRegistry(): SurfaceRegistry {
	const registry = useContext(SurfaceRegistryContext);
	if (registry === null) {
		throw new Error("A tab surface was drawn outside the app shell's SurfaceRegistryProvider.");
	}
	return registry;
}

/**
 * The slot a terminal tab renders in place of the terminal: it registers the terminal with the shell and
 * reports its box, and the shell draws the terminal over it.
 */
export function TerminalTabSlot({
	workspaceId,
	terminalId,
}: {
	workspaceId: WorkspaceId;
	terminalId: TerminalId;
}) {
	return (
		<TerminalSlot
			owner="tab"
			surfaceId={tabRef({ kind: "terminal", terminalId }) ?? ""}
			workspaceId={workspaceId}
			terminalId={terminalId}
		/>
	);
}

/** The slot the Run tab renders for an action's output terminal; the shell draws the terminal over it. */
export function RunTerminalSlot({
	workspaceId,
	terminalId,
}: {
	workspaceId: WorkspaceId;
	terminalId: TerminalId;
}) {
	return (
		<TerminalSlot
			owner="run"
			surfaceId={`run:${terminalId}`}
			workspaceId={workspaceId}
			terminalId={terminalId}
		/>
	);
}

/** The terminal of the workspace's run surface, so the Run tab shows it again after a switch. */
export function useRunSurfaceTerminal(workspaceId: WorkspaceId): TerminalId | null {
	const registry = useSurfaceRegistry();
	return useStore(
		registry.store,
		(state) =>
			state.surfaces.find(
				(surface) => surface.owner === "run" && surface.workspaceId === workspaceId,
			)?.terminalId ?? null,
	);
}

function TerminalSlot({
	owner,
	surfaceId,
	workspaceId,
	terminalId,
}: {
	owner: TerminalSurfaceConfig["owner"];
	surfaceId: string;
	workspaceId: WorkspaceId;
	terminalId: TerminalId;
}) {
	const registry = useSurfaceRegistry();
	useEffect(() => {
		registry.show({ surfaceId, kind: "terminal", owner, workspaceId, terminalId });
	}, [registry, surfaceId, owner, workspaceId, terminalId]);
	return <SurfaceAnchor surfaceId={surfaceId} onPlace={registry.place} />;
}

type TabState = "open" | "closed" | "unknown";

/**
 * Whether a registered terminal can still be shown: a tab's while the strip draws its tab, a run's while
 * its workspace is open. Unknown while a list is loading.
 */
function terminalTabState(
	surface: TerminalSurfaceConfig,
	workspaces: { loaded: boolean; byId: Readonly<Record<string, Workspace>> },
	terminals: Readonly<Record<string, readonly Terminal[]>>,
): TabState {
	if (!workspaces.loaded) return "unknown";
	const workspace = workspaces.byId[surface.workspaceId];
	if (workspace === undefined || workspace.state === "archived") return "closed";
	if (surface.owner === "run") return "open";
	const listed = terminals[surface.workspaceId];
	if (listed === undefined) return "unknown";
	return terminalTabs(listed).some((tab) => tab.terminalId === surface.terminalId)
		? "open"
		: "closed";
}

/** Mounted once by the app shell: draws every terminal whose slot can still show it, over its anchor. */
export function SurfaceHost({ registry }: { registry: SurfaceRegistry }) {
	const { services } = useServices();
	const surfaces = useStore(registry.store, (state) => state.surfaces);
	const placements = useStore(registry.store, (state) => state.placements);
	const focusSurfaceId = useStore(registry.store, (state) => state.focusSurfaceId);
	const workspacesLoaded = useStore(services.workspace.store, (state) => state.loaded);
	const workspacesById = useStore(services.workspace.store, (state) => state.workspacesById);
	const terminals = useStore(services.terminals.store, (state) => state.byWorkspace);

	const states = surfaces.map((surface) => ({
		surface,
		state: terminalTabState(surface, { loaded: workspacesLoaded, byId: workspacesById }, terminals),
	}));
	const closed = states.filter((entry) => entry.state === "closed");
	const closedKey = closed.map((entry) => entry.surface.surfaceId).join("\n");

	// A closed tab's registration goes, so the registry keeps only tabs that can still be shown.
	useEffect(() => {
		if (closedKey === "") return;
		registry.remove(new Set(closedKey.split("\n")));
	}, [registry, closedKey]);

	const specs: SurfaceSpec[] = states
		.filter((entry) => entry.state === "open")
		.map(({ surface }) => ({
			surfaceId: surface.surfaceId,
			kind: surface.kind,
			workspaceId: surface.workspaceId,
			content: (
				<NotBuiltYet area="Terminal" resetKey={surface.surfaceId}>
					<TerminalView
						terminalId={surface.terminalId}
						workspaceId={surface.workspaceId}
						visible={usableRect(placements.get(surface.surfaceId))}
						focusOnMount={surface.owner === "tab" && focusSurfaceId === surface.surfaceId}
					/>
				</NotBuiltYet>
			),
		}));

	return <SurfaceLayer surfaces={specs} placements={placements} focusSurfaceId={focusSurfaceId} />;
}
