/**
 * @feature NAV-01 Resizable wrappers
 * Owns: thin styled wrappers over react-resizable-panels (v4): a group, a panel and a drag handle. A group
 * remembers its sizes when the app provides a panel-layout store.
 * Behaviour: ui-map.md 1.1 (resizable left sidebar, centre, right panel; vertical split in the right panel);
 * ui-dimensions.md 3 (a 1px separator line that turns the ring colour on hover). Sizes: layout-sizes.ts.
 * Our design choice: sizes are strings with a unit ("30%", "280px"). In v4 a bare number means pixels,
 * which is easy to get wrong, so these wrappers take only strings. A group saves its layout through the one
 * store in context, so each workspace group persists by its own group id without extra wiring; a group whose
 * state lives elsewhere, such as the shell sidebar, passes `persist={false}`.
 * Must handle: the handle is a visible 1px line with an 8px hit area made by its ::before element, keyboard
 * resize (library), the library's double-click reset left on, a collapsed panel can be re-opened through its
 * panelRef, and a group with no store still works.
 * Test first: ResizableGroup renders one separator between two panels.
 */
import {
	Children,
	createContext,
	isValidElement,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";
import { Group, type GroupProps, Panel, type PanelProps, Separator } from "react-resizable-panels";
import { cn } from "./cn.ts";

export { useGroupRef, usePanelRef } from "react-resizable-panels";

/** Panel id to size in percent (0..100), as react-resizable-panels reports it. */
export type PanelLayout = Record<string, number>;

/** The one door a group uses to restore and remember its layout. */
export interface PanelLayoutStore {
	/** `knownPanels` are the ids in the group now, so a saved entry for a removed panel is ignored. */
	load(groupId: string, knownPanels?: readonly string[]): PanelLayout | null;
	save(groupId: string, layout: PanelLayout): void;
}

/** The ids of the panels directly inside a group, in order. Separators are left out. */
function panelIdsOf(children: ReactNode): string[] {
	const ids: string[] = [];
	Children.forEach(children, (child) => {
		if (!isValidElement<{ id?: string | number }>(child)) return;
		if (child.type !== ResizablePanel) return;
		if (child.props.id !== undefined) ids.push(String(child.props.id));
	});
	return ids;
}

const PanelLayoutContext = createContext<PanelLayoutStore | null>(null);

export function PanelLayoutProvider({
	store,
	children,
}: {
	store: PanelLayoutStore;
	children: ReactNode;
}) {
	return <PanelLayoutContext.Provider value={store}>{children}</PanelLayoutContext.Provider>;
}

export interface ResizableGroupProps extends GroupProps {
	/** Set false when the caller keeps this group's state somewhere else, for example the settings table. */
	persist?: boolean;
}

export function ResizableGroup({
	id,
	defaultLayout,
	onLayoutChanged,
	children,
	persist = true,
	...rest
}: ResizableGroupProps) {
	const store = useContext(PanelLayoutContext);
	const groupId = typeof id === "string" ? id : null;
	const knownPanels = useMemo(() => panelIdsOf(children), [children]);
	const savedLayout = useMemo(
		() => (persist && store !== null && groupId !== null ? store.load(groupId, knownPanels) : null),
		[persist, store, groupId, knownPanels],
	);
	const remember = useCallback<NonNullable<GroupProps["onLayoutChanged"]>>(
		(layout, meta) => {
			onLayoutChanged?.(layout, meta);
			if (persist && store !== null && groupId !== null) store.save(groupId, layout);
		},
		[persist, groupId, onLayoutChanged, store],
	);
	return (
		<Group
			{...rest}
			id={id}
			defaultLayout={savedLayout ?? defaultLayout}
			onLayoutChanged={remember}
		>
			{children}
		</Group>
	);
}

type SizeString = `${number}%` | `${number}px`;

export interface ResizablePanelProps
	extends Omit<PanelProps, "defaultSize" | "minSize" | "maxSize" | "collapsedSize"> {
	defaultSize?: SizeString;
	minSize?: SizeString;
	maxSize?: SizeString;
	collapsedSize?: SizeString;
}

export function ResizablePanel(props: ResizablePanelProps) {
	return <Panel {...props} />;
}

export function ResizeHandle({ className, label }: { className?: string; label?: string }) {
	return (
		<Separator
			aria-label={label}
			className={cn(
				"relative bg-separator outline-none transition-colors",
				"data-[separator=hover]:bg-focus data-[separator=active]:bg-focus",
				"aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px",
				// ui-dimensions.md 3: an 8px rail around the 1px line. The line keeps its size; the
				// pseudo-element only makes the target easier to grab.
				"before:absolute before:content-['']",
				"aria-[orientation=vertical]:before:inset-y-0",
				"aria-[orientation=vertical]:before:-left-[3.5px]",
				"aria-[orientation=vertical]:before:-right-[3.5px]",
				"aria-[orientation=horizontal]:before:inset-x-0",
				"aria-[orientation=horizontal]:before:-top-[3.5px]",
				"aria-[orientation=horizontal]:before:-bottom-[3.5px]",
				"data-[separator=focus]:bg-focus",
				className,
			)}
		/>
	);
}
