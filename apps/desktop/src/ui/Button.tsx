/**
 * @feature APP-05 Button
 * Owns: the one button component, in Conductor's seven variants and four sizes.
 * Behaviour: ui-map.md 8 (Button variants `default`, `destructive`, `outline`, `outlineDestructive`,
 * `secondary`, `ghost`, `link`); ui-dimensions.md 6.1 (sizes, padding, radii, weights).
 * Sizes are Conductor's: xs 24px, sm 28px, md 32px (its default), lg 44px.
 * `default` is the near-black fill (near-white in dark) with weight 500. The clay accent is not a button
 * colour (ui-dimensions.md 2.1). `secondary` is the muted-surface button, `outline` the transparent one with a
 * strong border, `ghost` the quiet one (both weight 450), `link` the text-only one.
 * Our design choice (D023): the keyboard focus ring stays on. Conductor turns it off on buttons.
 * Must handle: disabled (no hover colour), loading (spinner, blocks clicks, keeps width and keeps its own
 * accessible name, reports `aria-busy`), keyboard focus ring, `type` defaults to "button" so a button inside a
 * form never submits by accident.
 * Test first: renders each variant with its own class and a loading button is disabled.
 */
import type { ButtonHTMLAttributes, Ref } from "react";
import { cn } from "./cn.ts";
import { Spinner } from "./Spinner.tsx";

export type ButtonVariant =
	| "default"
	| "destructive"
	| "outline"
	| "outlineDestructive"
	| "secondary"
	| "ghost"
	| "link";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
	loading?: boolean;
	ref?: Ref<HTMLButtonElement>;
}

export const buttonVariantClass: Record<ButtonVariant, string> = {
	default: "bg-primary-fill font-medium text-canvas hover:opacity-90",
	destructive: "bg-danger-solid font-medium text-on-danger hover:opacity-90",
	outline:
		"border border-border-strong bg-transparent font-book text-fg hover:bg-hover active:bg-active",
	outlineDestructive:
		"border border-border-strong bg-transparent font-book text-danger hover:bg-hover active:bg-active",
	secondary: "bg-surface font-medium text-fg hover:bg-hover active:bg-active",
	ghost: "bg-transparent font-book text-fg/90 hover:bg-hover hover:text-fg active:bg-active",
	link: "bg-transparent font-medium text-fg/70 underline-offset-4 hover:text-fg hover:underline",
};

export const buttonSizeClass: Record<ButtonSize, string> = {
	xs: "h-6 gap-1.5 rounded-sm px-2 text-xs",
	sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs",
	md: "h-8 gap-2 rounded-md px-3 text-sm",
	lg: "h-11 gap-2 rounded-lg px-8",
};

/** Class names of a button, for links that must look like one (a link is not a <button>). */
export function buttonClassName({
	variant = "default",
	size = "md",
	className,
}: {
	variant?: ButtonVariant;
	size?: ButtonSize;
	className?: string;
}): string {
	return cn(
		"relative inline-flex shrink-0 items-center justify-center transition-colors",
		"disabled:pointer-events-none disabled:opacity-50",
		buttonVariantClass[variant],
		buttonSizeClass[size],
		className,
	);
}

export function Button({
	variant = "default",
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
			aria-busy={loading || undefined}
			className={buttonClassName({ variant, size, className })}
			{...rest}
		>
			<span className={cn("inline-flex items-center gap-[inherit]", loading && "opacity-0")}>
				{children}
			</span>
			{loading ? (
				<span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
					<Spinner size="sm" label="Working" />
				</span>
			) : null}
		</button>
	);
}
