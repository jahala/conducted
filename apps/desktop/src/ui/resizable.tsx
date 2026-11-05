/**
 * @feature NAV-01 Resizable wrappers
 * Owns: thin styled wrappers over react-resizable-panels (v4): a group, a panel and a drag handle.
 * Behaviour: ui-map.md 1.1 (resizable left sidebar, centre, right panel; vertical split in the right panel);
 * ui-dimensions.md 3 (a 1px separator line that turns the ring colour on hover). Sizes: layout-sizes.ts.
 * Our design choice: sizes are strings with a unit ("30%", "280px"). In v4 a bare number means pixels,
 * which is easy to get wrong, so these wrappers take only strings.
 * Must handle: the handle is a visible 1px line with a wider hit area, keyboard resize (library), double click
 * resets, a collapsed panel can be re-opened through its panelRef.
 * Test first: ResizableGroup renders one separator between two panels.
 */
import { Group, Panel, type PanelProps, Separator } from "react-resizable-panels";
import { cn } from "./cn.ts";

export { useGroupRef, usePanelRef } from "react-resizable-panels";
export const ResizableGroup = Group;

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
