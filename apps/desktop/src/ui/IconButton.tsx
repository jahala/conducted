/**
 * @feature APP-05 IconButton
 * Owns: a square button that holds only an icon. It always has an accessible name and a tooltip.
 * Behaviour: ui-map.md 8 (icon sizes of the Conductor button), 1.1 ("Toggle left sidebar", "Go back").
 * Must handle: `label` is required and doubles as aria-label and tooltip text; `shortcut` shows a keycap in the
 * tooltip; pressed state for toggles (aria-pressed); disabled shows no tooltip.
 * Test first: exposes the label as its accessible name.
 */
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./Button.tsx";
import { cn } from "./cn.ts";
import { Tooltip } from "./Tooltip.tsx";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
	label: string;
	icon: ReactNode;
	/** Display form of the shortcut, from the command registry. */
	shortcut?: string;
	pressed?: boolean;
}

export function IconButton({
	label,
	icon,
	shortcut,
	pressed,
	variant = "ghost",
	size = "md",
	className,
	...rest
}: IconButtonProps) {
	const button = (
		<Button
			variant={variant}
			size={size}
			aria-label={label}
			aria-pressed={pressed}
			className={cn("px-0", size === "sm" ? "w-7" : size === "lg" ? "w-10" : "w-8", className)}
			{...rest}
		>
			{icon}
		</Button>
	);
	if (rest.disabled) return button;
	return (
		<Tooltip content={label} shortcut={shortcut}>
			{button}
		</Tooltip>
	);
}
