/**
 * @feature APP-05 Tabs
 * Owns: tab lists for panels (git panel, scripts panel, settings pages), built on the radix Tabs.
 * Behaviour: ui-map.md 8 (Tabs with trigger, content and close button), 3.6 and 3.7 (panel tab strips);
 * ui-dimensions.md 3 (tab list 40px with 8px gaps at weight 350; a tab is 40px with 2px top padding, text-sm
 * medium in muted text; the active tab has fg text and a 2px underline in the accent).
 * Conductor's tab list clips and never scrolls (renderApp @4392128: `min-w-0 overflow-hidden
 * max-w-full`), and its tab is `min-w-0 overflow-hidden whitespace-nowrap` with no negative margin
 * (@4392863); its Git panel strip clips too (@2554131). A list that scrolls draws a scrollbar on a Mac
 * whose scrollbars take space, and a tab one pixel taller than the list gave it one (issue #625).
 * Must handle: arrow-key navigation (radix), a disabled tab, more tabs than fit (underlined tabs
 * shrink and clip their labels; pills keep their width and the list clips them; none wrap or scroll),
 * content unmounts when hidden unless `forceMount` is used by the caller.
 * Test first: selecting a trigger shows its content and hides the other.
 */
import { Tabs as Radix } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const Tabs = Radix.Root;

export function TabsList({ className, ...rest }: ComponentProps<typeof Radix.List>) {
	return (
		<Radix.List
			className={cn(
				"flex h-10 min-w-0 max-w-full shrink-0 items-center gap-2 overflow-hidden border-b border-separator px-2 font-light",
				className,
			)}
			{...rest}
		/>
	);
}

export function TabsTrigger({
	className,
	variant = "underline",
	...rest
}: ComponentProps<typeof Radix.Trigger> & {
	/** underline: the 2px accent line of centre tabs. pill: the filled 28px pill of the Git panel's tabs. */
	variant?: "underline" | "pill";
}) {
	return (
		<Radix.Trigger
			className={cn(
				variant === "underline"
					? "inline-flex h-10 min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap border-b-2 border-transparent px-2 pt-0.5 data-[state=active]:border-accent"
					: "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 hover:bg-hover data-[state=active]:bg-active",
				"text-sm font-medium text-fg-muted transition-colors hover:text-fg",
				"data-[state=active]:text-fg",
				"disabled:pointer-events-none disabled:opacity-50",
				// The list clips what passes its edges, as Conductor's does, so the keyboard focus outline
				// is drawn inside the tab to stay visible (D023).
				"focus-visible:-outline-offset-2",
				className,
			)}
			{...rest}
		/>
	);
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof Radix.Content>) {
	return <Radix.Content className={cn("min-h-0 flex-1", className)} {...rest} />;
}
