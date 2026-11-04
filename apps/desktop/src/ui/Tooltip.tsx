/**
 * @feature APP-05 Tooltip
 * Owns: a short text hint on hover or keyboard focus, built on the radix Tooltip.
 * Behaviour: ui-map.md 8 (Tooltip), 5.4 (tooltips show the live shortcut).
 * Must handle: it carries its own provider so it works anywhere; it never holds the only copy of important
 * information (the trigger keeps its own accessible name); the shortcut is optional.
 * Test first: hovering or focusing the trigger shows the content.
 */
import { Tooltip as Radix } from "radix-ui";
import type { ReactElement } from "react";
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
						className="z-50 flex items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-canvas shadow-popover"
					>
						{content}
						{shortcut ? (
							<Kbd className="border-transparent bg-transparent text-canvas">{shortcut}</Kbd>
						) : null}
					</Radix.Content>
				</Radix.Portal>
			</Radix.Root>
		</Radix.Provider>
	);
}
