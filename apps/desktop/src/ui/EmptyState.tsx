/**
 * @feature APP-04 EmptyState
 * Owns: the layout of every designed empty state: a title, one sentence of help, and one action.
 * Behaviour: ui-map.md 7.2 (designed empty states such as "No matching workspaces" and "Add a project to get started.").
 * Our design choice: poster logic for screens people land on. The title is large, the body is short and muted,
 * and the single action sits below. `compact` is for small regions such as a sidebar or a panel.
 * Must handle: no action (information only), a long body wraps, the region reads as one landmark for screen readers,
 * a failed tone for errors, an optional icon that shares the tone's colour.
 * Test first: renders the title, the body and the action; omits the body element when none is given.
 */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type EmptyStateTone = "neutral" | "failed";

export interface EmptyStateProps {
	title: string;
	body?: string;
	/** Usually one <Button variant="default">. */
	action?: ReactNode;
	icon?: ReactNode;
	/** Neutral for invitations; failed for errors and blocked regions. */
	tone?: EmptyStateTone;
	compact?: boolean;
	className?: string;
}

export function EmptyState({
	title,
	body,
	action,
	icon,
	tone = "neutral",
	compact = false,
	className,
}: EmptyStateProps) {
	const failed = tone === "failed";
	return (
		<section
			aria-label={title}
			data-tone={tone}
			className={cn(
				"flex h-full w-full flex-col items-center justify-center text-center",
				compact ? "gap-2 p-4" : "gap-3 p-10",
				className,
			)}
		>
			{icon ? <div className={failed ? "text-danger" : "text-fg-subtle"}>{icon}</div> : null}
			<h2
				className={cn(
					"font-medium",
					failed ? "text-danger" : "text-fg",
					compact ? "text-base" : "text-xl",
				)}
			>
				{title}
			</h2>
			{body ? <p className="max-w-prose text-sm text-fg-muted">{body}</p> : null}
			{action ? <div className={cn(compact ? "mt-1" : "mt-3")}>{action}</div> : null}
		</section>
	);
}
