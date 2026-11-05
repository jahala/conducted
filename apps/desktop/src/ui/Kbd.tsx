/**
 * @feature APP-05 Kbd
 * Owns: a keycap label such as "⌘K", used in tooltips, menus and hints.
 * Behaviour: ui-map.md 8 (Conductor's keycap hint reads the live key binding so hints follow rebinds);
 * ui-dimensions.md 6.2 (shortcut chip: 16px tall, at least 20px wide, 4px sides, 10px text, 4px radius, muted
 * fill, 1px border).
 * Must handle: the text comes from the command registry (core/registries), never typed by hand in a screen.
 * Test first: renders its children inside a <kbd> element.
 */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<kbd
			className={cn(
				"inline-flex h-4 min-w-5 items-center justify-center rounded-sm border border-border",
				"bg-muted px-1 font-sans text-3xs text-fg-muted",
				className,
			)}
		>
			{children}
		</kbd>
	);
}
