/**
 * @feature APP-13 Alert
 * Owns: the banner that tells the user something, in a neutral or a destructive tone.
 * Behaviour: ui-map.md 8 (Alert with Title and Description, tones default and destructive);
 * ui-dimensions.md 6.2 (8px radius, 1px border, 16px padding; icon 16px from the top and left; text
 * indented 28px).
 * Our design choice: the banner is a live region (`role="alert"`) because every current use is a failure
 * or a warning the user must hear. Danger carries function only: the border and the title turn danger,
 * the body stays readable foreground and muted text.
 * Must handle: a title alone, a description alone, both; an optional icon; the destructive tone; a caller
 * that adds actions inside the body.
 * Test first: the alert renders as a live region with its title and description, and the destructive tone
 * marks its border.
 */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export type AlertTone = "default" | "destructive";

export interface AlertProps {
	tone?: AlertTone;
	/** A 16px icon, placed at the top left. */
	icon?: ReactNode;
	className?: string;
	children: ReactNode;
}

export function Alert({ tone = "default", icon, className, children }: AlertProps) {
	return (
		<div
			role="alert"
			data-tone={tone}
			className={cn(
				"group relative w-full rounded-lg border p-4 text-sm",
				tone === "destructive"
					? "border-danger bg-surface text-fg"
					: "border-border bg-surface text-fg",
				className,
			)}
		>
			{icon ? (
				<span
					aria-hidden="true"
					className={cn(
						"absolute top-4 left-4 flex size-4 items-center justify-center",
						tone === "destructive" ? "text-danger" : "text-fg-muted",
					)}
				>
					{icon}
				</span>
			) : null}
			<div className={cn("flex flex-col gap-1", icon ? "pl-7" : undefined)}>{children}</div>
		</div>
	);
}

export function AlertTitle({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<p className={cn("font-medium text-fg group-data-[tone=destructive]:text-danger", className)}>
			{children}
		</p>
	);
}

export function AlertDescription({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("text-fg-muted", className)}>{children}</div>;
}
