/**
 * @feature APP-13 Separator
 * Owns: the 1px line that separates groups of content, horizontal or vertical.
 * Behaviour: ui-map.md 8 (Separator); ui-dimensions.md 4 (menu separators are 1px) and 6.3 (1px borders
 * almost everywhere).
 * Our design choice: the line uses the `separator` token, which is decorative. A separator that carries
 * meaning is exposed to screen readers unless the caller marks it decorative; a purely visual line is.
 * Must handle: horizontal and vertical orientation; decorative and semantic; a caller that needs its own
 * length or colour through className.
 * Test first: it is a horizontal separator by default, a vertical one when asked, and has no role when
 * decorative.
 */
import { Separator as Radix } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export type SeparatorProps = ComponentProps<typeof Radix.Root>;

export function Separator({
	orientation = "horizontal",
	decorative = false,
	className,
	...props
}: SeparatorProps) {
	return (
		<Radix.Root
			orientation={orientation}
			decorative={decorative}
			className={cn(
				"shrink-0 bg-separator",
				orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
				className,
			)}
			{...props}
		/>
	);
}
