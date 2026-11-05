/**
 * @feature APP-05 Spinner
 * Owns: the one loading indicator, in the four kinds Conductor shows: working, typing, waiting and setting-up.
 * Behaviour: ui-map.md 7.3 (loading regions use role="status" and an aria-label such as "Loading workspaces";
 * the loader has types working, typing, waiting and setting-up).
 * Must handle: a label is always present for screen readers; size follows the surrounding text unless set;
 * reduced motion stops the turn and the dots' pulse (styles.css switches animation off).
 * Test first: renders role="status" with the label, and exposes its kind.
 */
import { cn } from "./cn.ts";

export type SpinnerKind = "working" | "typing" | "waiting" | "setting-up";

export interface SpinnerProps {
	label: string;
	kind?: SpinnerKind;
	size?: "sm" | "md" | "lg";
	className?: string;
}

const sizeClass = { sm: "size-3.5", md: "size-4", lg: "size-6" } as const;

const turnClass: Record<Exclude<SpinnerKind, "typing">, string> = {
	working: "animate-spin",
	waiting: "animate-spin [animation-duration:2s]",
	"setting-up": "animate-spin [animation-duration:1.4s]",
};

const dotDelay = ["0ms", "150ms", "300ms"] as const;

export function Spinner({ label, kind = "working", size = "md", className }: SpinnerProps) {
	return (
		<span
			role="status"
			aria-label={label}
			data-kind={kind}
			className={cn("inline-flex items-center justify-center", className)}
		>
			{kind === "typing" ? (
				<span aria-hidden="true" className="flex items-center gap-1">
					{dotDelay.map((delay) => (
						<span
							key={delay}
							className="size-1 animate-pulse rounded-full bg-current"
							style={{ animationDelay: delay }}
						/>
					))}
				</span>
			) : (
				<svg
					viewBox="0 0 24 24"
					fill="none"
					className={cn(turnClass[kind], sizeClass[size])}
					aria-hidden="true"
				>
					<circle
						cx="12"
						cy="12"
						r="9"
						stroke="currentColor"
						strokeOpacity="0.25"
						strokeWidth="3"
					/>
					<path
						d="M21 12a9 9 0 0 0-9-9"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
					/>
				</svg>
			)}
		</span>
	);
}
