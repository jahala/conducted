/**
 * @feature APP-05 Spinner
 * Owns: the one loading indicator. It is a ring that turns; reduced motion stops the turn.
 * Behaviour: ui-map.md 7.3 (loading regions use role="status" and an aria-label such as "Loading workspaces").
 * Must handle: a label is always present for screen readers; size follows the surrounding text unless set.
 * Test first: renders role="status" with the label.
 */
import { cn } from "./cn.ts";

export interface SpinnerProps {
	label: string;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const sizeClass = { sm: "size-3.5", md: "size-4", lg: "size-6" } as const;

export function Spinner({ label, size = "md", className }: SpinnerProps) {
	return (
		<span role="status" aria-label={label} className={cn("inline-flex", className)}>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				className={cn("animate-spin", sizeClass[size])}
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
				<path
					d="M21 12a9 9 0 0 0-9-9"
					stroke="currentColor"
					strokeWidth="3"
					strokeLinecap="round"
				/>
			</svg>
		</span>
	);
}
