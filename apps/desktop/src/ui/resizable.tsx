/**
 * @feature NAV-01 Resizable wrappers
 * Owns: thin styled wrappers over react-resizable-panels (v4): a group, a panel and a drag handle. A group
 * remembers its sizes when the app provides a panel-layout store.
 * Behaviour: ui-map.md 1.1 (resizable left sidebar, centre, right panel; vertical split in the right panel);
 * ui-dimensions.md 3 (a 1px separator line that turns the ring colour on hover). Sizes: layout-sizes.ts.
 * Our design choice: sizes are strings with a unit ("30%", "280px"). In v4 a bare number means pixels,
 * which is easy to get wrong, so these wrappers take only strings. A group saves its layout through the one
 * store in context, so the shell and every workspace group persist by their own group id without extra wiring.
 * Must handle: the handle is a visible 1px line with a wider hit area, keyboard resize (library), double click
 * resets, a collapsed panel can be re-opened through its panelRef, and a group with no store still works.
 * Test first: ResizableGroup renders one separator between two panels.
 */
import { createContext, type ReactNode, useCallback, useContext, useMemo } from "react";
import { Group, type GroupProps, Panel, type PanelProps, Separator } from "react-resizable-panels";
import { cn } from "./cn.ts";

export { useGroupRef, usePanelRef } from "react-resizable-panels";

/** Panel id to size in percent (0..100), as react-resizable-panels reports it. */
export type PanelLayout = Record<string, number>;

/** The one door a group uses to restore and remember its layout. */
export interface PanelLayoutStore {
	load(groupId: string): PanelLayout | null;
	save(groupId: string, layout: PanelLayout): void;
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

export function ResizableGroup({
	id,
	defaultLayout,
	onLayoutChanged,
	children,
	...rest
}: GroupProps) {
	const store = useContext(PanelLayoutContext);
	const groupId = typeof id === "string" ? id : null;
	const savedLayout = useMemo(
		() => (store !== null && groupId !== null ? store.load(groupId) : null),
		[store, groupId],
	);
	const remember = useCallback<NonNullable<GroupProps["onLayoutChanged"]>>(
		(layout, meta) => {
			onLayoutChanged?.(layout, meta);
			if (store !== null && groupId !== null) store.save(groupId, layout);
		},
		[groupId, onLayoutChanged, store],
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

export function ResizeHandle({ className }: { className?: string }) {
	return (
		<Separator
			className={cn(
				"relative bg-separator outline-none transition-colors",
				"data-[separator=hover]:bg-focus data-[separator=active]:bg-focus",
				"aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px",
				"data-[separator=focus]:bg-focus",
				className,
			)}
		/>
	);
}
