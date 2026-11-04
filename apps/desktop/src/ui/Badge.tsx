/**
 * @feature APP-05 Badge
 * Owns: a small label for states such as "Draft" or "Archived". It is neutral unless it carries function.
 * Behaviour: ui-map.md 8 (Badge variants), 4 (row badges: Draft, Archive workspace).
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
				"inline-flex h-5 items-center rounded-sm border px-1.5 text-xs font-medium",
				toneClass[tone],
			)}
		>
			{children}
		</span>
	);
}
