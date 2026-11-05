/**
 * @feature APP-05 Badge
 * Owns: a small label for states such as "Draft" or "Archived". It is neutral unless it carries function.
 * Behaviour: ui-map.md 8 (Badge variants), 4 (row badges: Draft, Archive workspace); ui-dimensions.md 6.2
 * (8px by 2px padding, mono uppercase text-xs with 0.6px tracking, 6px radius, 1px border).
 * Our design choice: only neutral, danger, warning and success tones. No decorative colours.
 * Must handle: text truncates; the tone is never the only signal (the text says the state).
 * Test first: renders its text with the tone class.
 */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type BadgeTone = "neutral" | "danger" | "warning" | "success";

const toneClass: Record<BadgeTone, string> = {
	neutral: "border-border text-fg-muted",
	danger: "border-danger text-danger",
	warning: "border-warning text-warning",
	success: "border-success text-success",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs uppercase tracking-wider",
				toneClass[tone],
			)}
		>
			{children}
		</span>
	);
}
