/**
 * @feature APP-05 Tooltip
 * Owns: a short text hint on hover or keyboard focus, built on the radix Tooltip.
 * Behaviour: ui-map.md 8 (Tooltip), 5.4 (tooltips show the live shortcut); ui-dimensions.md 6.2 (text-xs,
 * 8px left, 4px top and bottom, 8px right or 4px with a shortcut, 4px radius, 1px ring, shadow-md).
 * Our design choice (D022 AA rule): the fill is the solid raised colour. Conductor draws it at 50% with a blur,
 * which cannot promise 4.5:1 over whatever sits behind it.
 * Must handle: it carries its own provider so it works anywhere; it never holds the only copy of important
 * information (the trigger keeps its own accessible name); the shortcut is optional.
 * Test first: hovering or focusing the trigger shows the content.
 */
import { Tooltip as Radix } from "radix-ui";
import type { ReactElement } from "react";
import { cn } from "./cn.ts";
import { Kbd } from "./Kbd.tsx";

export interface TooltipProps {
	content: string;
	shortcut?: string;
	side?: "top" | "right" | "bottom" | "left";
	/** One element that can take a ref and focus. */
	children: ReactElement;
}

export function Tooltip({ content, shortcut, side = "bottom", children }: TooltipProps) {
	return (
		<Radix.Provider delayDuration={500} skipDelayDuration={200}>
			<Radix.Root>
				<Radix.Trigger asChild>{children}</Radix.Trigger>
				<Radix.Portal>
					<Radix.Content
						side={side}
						sideOffset={6}
						className={cn(
							"z-50 flex items-center gap-2 rounded-sm bg-raised py-1 pl-2 text-xs tracking-wide text-fg",
							"shadow-popover",
							shortcut ? "pr-1" : "pr-2",
						)}
					>
						{content}
						{shortcut ? <Kbd>{shortcut}</Kbd> : null}
					</Radix.Content>
				</Radix.Portal>
			</Radix.Root>
		</Radix.Provider>
	);
}
