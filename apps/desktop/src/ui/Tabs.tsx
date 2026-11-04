/**
 * @feature APP-05 Tabs
 * Owns: tab lists for panels (git panel, scripts panel, settings pages), built on the radix Tabs.
 * Behaviour: ui-map.md 8 (Tabs with trigger, content and close button), 3.6 and 3.7 (panel tab strips).
 * Our design choice: the active tab is marked by weight and an underline in the foreground colour, not the accent.
 * The accent stays free for the one primary action.
 * Must handle: arrow-key navigation (radix), a disabled tab, many tabs scroll instead of wrapping,
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
				"flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2",
				className,
			)}
			{...rest}
		/>
	);
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof Radix.Trigger>) {
	return (
		<Radix.Trigger
			className={cn(
				"-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2",
				"text-sm font-medium text-fg-muted transition-colors hover:text-fg",
				"data-[state=active]:border-fg data-[state=active]:text-fg",
				"disabled:pointer-events-none disabled:opacity-50",
				className,
			)}
			{...rest}
		/>
	);
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof Radix.Content>) {
	return <Radix.Content className={cn("min-h-0 flex-1", className)} {...rest} />;
}
