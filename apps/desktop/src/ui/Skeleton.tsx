/**
 * @feature APP-04 Skeleton
 * Owns: a grey block that stands in for content while it loads.
 * Behaviour: ui-map.md 7.3 (skeleton blocks for panels and cards, role="status" with an aria-label).
 * Must handle: the loading region announces itself once (the wrapper has role="status", blocks are hidden from
 * screen readers); reduced motion removes the pulse.
 * Test first: renders aria-hidden blocks.
 */
import { cn } from "./cn.ts";

export function Skeleton({ className }: { className?: string }) {
	return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-hover", className)} />;
}
