/**
 * @feature APP-13 Toggle and ToggleGroup
 * Owns: the pressed-and-unpressed button and the group that makes one or several of them a segmented choice.
 * Behaviour: ui-map.md 8 (Toggle, ToggleGroup, ToggleGroupItem); ui-dimensions.md 6.1 (default toggle 32px
 * tall with 8px sides, text-sm and 6px radius; small 24px tall with text-xs and 4px radius).
 * Our design choice: the pressed state fills with the `active` surface, the same selected fill the tab
 * strip uses, so the one clay accent stays free for the thing to look at. The keyboard focus ring comes
 * from the global focus rule (D023).
 * Must handle: controlled and uncontrolled pressed state (radix), single and multiple groups, a disabled
 * toggle or group, an item without a label (the caller gives it an aria-label).
 * Test first: clicking a toggle calls onPressedChange with the opposite value, and a single group reports
 * the chosen value.
 */
import { Toggle as RadixToggle, ToggleGroup as RadixToggleGroup } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export type ToggleSize = "sm" | "md";

export function toggleClass(size: ToggleSize, className?: string): string {
	return cn(
		"inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium text-fg-muted transition-colors",
		"hover:bg-hover hover:text-fg data-[state=on]:bg-active data-[state=on]:text-fg",
		"disabled:pointer-events-none disabled:opacity-50",
		size === "sm" ? "h-6 rounded-sm px-2 text-xs" : "h-8 px-2 text-sm",
		className,
	);
}

export interface ToggleProps extends ComponentProps<typeof RadixToggle.Root> {
	size?: ToggleSize;
}

export function Toggle({ size = "md", className, ...props }: ToggleProps) {
	return <RadixToggle.Root className={toggleClass(size, className)} {...props} />;
}

export type ToggleGroupProps = ComponentProps<typeof RadixToggleGroup.Root>;

export function ToggleGroup({ className, ...props }: ToggleGroupProps) {
	return (
		<RadixToggleGroup.Root className={cn("inline-flex items-center gap-1", className)} {...props} />
	);
}

export interface ToggleGroupItemProps extends ComponentProps<typeof RadixToggleGroup.Item> {
	size?: ToggleSize;
}

export function ToggleGroupItem({ size = "md", className, ...props }: ToggleGroupItemProps) {
	return <RadixToggleGroup.Item className={toggleClass(size, className)} {...props} />;
}
