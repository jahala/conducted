/**
 * @feature APP-13 Collapsible
 * Owns: the disclosure that shows and hides a block of content, built on the radix Collapsible.
 * Behaviour: ui-map.md 8 (Collapsible with Trigger and Content; used for sidebar groups, long PATH values
 * and tool calls); ui-dimensions.md 1.7 (short transitions, off under reduced motion).
 * Our design choice: the trigger is a quiet button that reports aria-expanded through radix, and the content
 * is unmounted while closed so hidden DOM does not keep focusable children. Screens style their own trigger
 * when they need an icon: the parts pass className through.
 * Must handle: closed and open on first render; toggling from the keyboard; a caller that supplies its own
 * trigger element with asChild.
 * Test first: clicking the trigger shows the content, sets aria-expanded and hides it again.
 */
import { Collapsible as Radix } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export const Collapsible = Radix.Root;

export type CollapsibleTriggerProps = ComponentProps<typeof Radix.Trigger>;

export function CollapsibleTrigger({ className, ...props }: CollapsibleTriggerProps) {
	return (
		<Radix.Trigger
			className={cn(
				"inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-fg transition-colors hover:bg-hover",
				className,
			)}
			{...props}
		/>
	);
}

export type CollapsibleContentProps = ComponentProps<typeof Radix.Content>;

export function CollapsibleContent({ className, ...props }: CollapsibleContentProps) {
	return <Radix.Content className={cn("overflow-hidden", className)} {...props} />;
}
