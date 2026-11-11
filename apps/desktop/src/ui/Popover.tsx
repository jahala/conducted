/**
 * @feature APP-05 Popover
 * Owns: floating panels anchored to a button (model picker, context hover card, forward ports), built on
 * the radix Popover. `hover` switches to the radix HoverCard for the context usage card.
 * Behaviour: ui-map.md 5.2 (popovers: model picker, forward ports, context usage hover card), 8 (Popover and
 * HoverCard parts). ui-dimensions.md 6.2 gives the popover look; popovers and tooltips fade in 100ms.
 * Must handle: focus moves in on open and back on close, Escape closes, flips at window edges, a hover variant
 * that opens on pointer hover and on keyboard focus (context card), a caller-set width, inline style, offset or edge padding.
 * Test first: clicking the trigger shows the content; Escape hides it and returns focus to the trigger.
 */
import { HoverCard, Popover as Radix } from "radix-ui";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { cn } from "./cn.ts";

export type PopoverSide = "top" | "right" | "bottom" | "left";
export type PopoverAlign = "start" | "center" | "end";

export interface PopoverProps {
	/** One element that can take a ref and focus. */
	trigger: ReactElement;
	children: ReactNode;
	side?: PopoverSide;
	align?: PopoverAlign;
	/** Opens on hover and focus instead of click. */
	hover?: boolean;
	className?: string;
	/** Inline style for the panel, for a size worked out at runtime. */
	style?: CSSProperties;
	/** Gap between the trigger and the panel, in pixels. */
	sideOffset?: number;
	/** The least distance kept from the window's edges, in pixels. */
	collisionPadding?: number;
	/** Told when the popover opens or closes, for content that is read on opening. */
	onOpenChange?: (open: boolean) => void;
	/** Set to control the open state from the caller (a flyout that closes after a choice). */
	open?: boolean;
}

const contentClass = "z-50 rounded-lg bg-raised p-3 text-sm text-fg shadow-popover outline-none";

export function Popover({
	trigger,
	children,
	side = "bottom",
	align = "center",
	hover = false,
	className,
	style,
	sideOffset = 6,
	collisionPadding = 0,
	onOpenChange,
	open,
}: PopoverProps) {
	if (hover) {
		return (
			<HoverCard.Root openDelay={200} closeDelay={150} onOpenChange={onOpenChange}>
				<HoverCard.Trigger asChild>{trigger}</HoverCard.Trigger>
				<HoverCard.Portal>
					<HoverCard.Content
						side={side}
						align={align}
						sideOffset={sideOffset}
						collisionPadding={collisionPadding}
						className={cn(contentClass, className)}
						style={style}
					>
						{children}
					</HoverCard.Content>
				</HoverCard.Portal>
			</HoverCard.Root>
		);
	}
	return (
		<Radix.Root open={open} onOpenChange={onOpenChange}>
			<Radix.Trigger asChild>{trigger}</Radix.Trigger>
			<Radix.Portal>
				<Radix.Content
					side={side}
					align={align}
					sideOffset={sideOffset}
					collisionPadding={collisionPadding}
					className={cn(contentClass, className)}
					style={style}
				>
					{children}
				</Radix.Content>
			</Radix.Portal>
		</Radix.Root>
	);
}
