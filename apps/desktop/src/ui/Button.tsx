/**
 * @feature APP-05 Button
 * Owns: the one button component, in four variants and three sizes.
 * Behaviour: ui-map.md 8 (Conductor's Button has default, destructive, outline, secondary, ghost and link variants).
 * Our design choice: four variants. `primary` is the single assertive action on a screen and uses the accent.
 * `secondary` is a quiet outlined button, `ghost` has no edge until hover, `danger` is for destructive confirmations.
 * Must handle: disabled (no hover colour), loading (spinner, blocks clicks, keeps width), keyboard focus ring,
 * `type` defaults to "button" so a button inside a form never submits by accident.
 * Test first: renders each variant with its own class and a loading button is disabled.
 */
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn.ts";
import { Spinner } from "./Spinner.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	ref?: Ref<HTMLButtonElement>;
}

export const buttonVariantClass: Record<ButtonVariant, string> = {
	primary: "bg-accent text-on-accent hover:bg-accent-hover",
	secondary: "border border-border-strong bg-transparent text-fg hover:bg-hover active:bg-active",
	ghost: "bg-transparent text-fg-muted hover:bg-hover hover:text-fg active:bg-active",
	danger: "bg-danger-solid text-on-danger hover:opacity-90",
};

export const buttonSizeClass: Record<ButtonSize, string> = {
	sm: "h-7 gap-1 px-2 text-sm",
	md: "h-8 gap-1.5 px-3 text-sm",
	lg: "h-10 gap-2 px-4 text-base",
};

/** Class names of a button, for links that must look like one (a link is not a <button>). */
export function buttonClassName({
	variant = "secondary",
	size = "md",
	className,
}: {
	variant?: ButtonVariant;
	size?: ButtonSize;
	className?: string;
}): string {
	return cn(
		"relative inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors",
		"disabled:pointer-events-none disabled:opacity-50",
		buttonVariantClass[variant],
		buttonSizeClass[size],
		className,
	);
}

export function Button({
	variant = "secondary",
	size = "md",
	loading = false,
	disabled,
	type = "button",
	className,
	children,
	...rest
}: ButtonProps) {
	return (
		<button
			type={type}
			data-variant={variant}
			disabled={disabled || loading}
			className={buttonClassName({ variant, size, className })}
			{...rest}
		>
			<span className={cn("inline-flex items-center gap-[inherit]", loading && "invisible")}>
				{children}
			</span>
			{loading ? (
				<span className="absolute inset-0 flex items-center justify-center">
					<Spinner size="sm" label="Working" />
				</span>
			) : null}
		</button>
	);
}
