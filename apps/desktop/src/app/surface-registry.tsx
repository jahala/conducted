/**
 * @feature NAV-15 Terminals and previews that survive tab switches
 * @feature NAV-01 App shell: the surface layout registry
 * Owns: the surface layout registry the app shell creates (the surfaces a tab has shown, where each one's
 * anchor is, and which surface asked for focus); the slot a terminal tab renders, which registers its
 * terminal and reports its anchor; and the host the shell mounts once, which draws the registry through
 * SurfaceLayer.
 * Behaviour: services-map.md 1.5 (surface layout registry: anchors, surface configs, placements, requested
 * focus surface), ui-map.md 1.1 (a surface layer mounted once at the root keeps terminals alive over
 * anchors) and 8.
 * Our design choice: a terminal is registered the first time its tab is shown, so a terminal nobody looked
 * at starts no view. It stays mounted while it is one of the tabs the strip draws for a workspace that
 * still exists and is not archived (terminalTabs in TabStrip.tsx). Once its tab is gone, its registration
 * is removed and its view unmounts. The registry is a store the shell creates for itself, not module
 * state. Browser previews have no surface yet: their tab is RUN-04's placeholder.
 * Must handle: a tab switch (the anchor unmounts, its placement becomes null, the terminal hides and keeps
 * its scrollback and shell); the tab shown again (the anchor reports its box, the terminal shows and takes
 * focus); a tab that leaves the strip, or a workspace that is archived or deleted (the terminal unmounts);
 * a terminal list or workspace list that has not loaded yet (the registration waits, nothing is drawn).
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

/** One terminal a tab has shown. */
export interface TerminalSurfaceConfig {
	surfaceId: string;
	kind: "terminal";
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
	/** A tab shows this surface: register it if it is new, and ask for focus. */
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
			store.setState((state) => ({
				surfaces: state.surfaces.some((surface) => surface.surfaceId === config.surfaceId)
					? state.surfaces
					: [...state.surfaces, config],
				focusSurfaceId: config.surfaceId,
			})),
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
	const registry = useSurfaceRegistry();
	const surfaceId = tabRef({ kind: "terminal", terminalId }) ?? "";
	useEffect(() => {
		registry.show({ surfaceId, kind: "terminal", workspaceId, terminalId });
	}, [registry, surfaceId, workspaceId, terminalId]);
	return <SurfaceAnchor surfaceId={surfaceId} onPlace={registry.place} />;
}

type TabState = "open" | "closed" | "unknown";

/** Whether a registered terminal is still a tab the strip draws. Unknown while a list is loading. */
function terminalTabState(
	surface: TerminalSurfaceConfig,
	workspaces: { loaded: boolean; byId: Readonly<Record<string, Workspace>> },
	terminals: Readonly<Record<string, readonly Terminal[]>>,
): TabState {
	if (!workspaces.loaded) return "unknown";
	const workspace = workspaces.byId[surface.workspaceId];
	if (workspace === undefined || workspace.state === "archived") return "closed";
	const listed = terminals[surface.workspaceId];
	if (listed === undefined) return "unknown";
	return terminalTabs(listed).some((tab) => tab.terminalId === surface.terminalId)
		? "open"
		: "closed";
}

/** Mounted once by the app shell: draws every terminal whose tab is open, over its tab's anchor. */
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
						focusOnMount={focusSurfaceId === surface.surfaceId}
					/>
				</NotBuiltYet>
			),
		}));

	return <SurfaceLayer surfaces={specs} placements={placements} focusSurfaceId={focusSurfaceId} />;
}
