/**
 * @feature APP-05 Menu
 * Owns: dropdown menus (workspace actions, view options, open in), built on the radix DropdownMenu.
 * Behaviour: ui-map.md 8 (DropdownMenu parts), 3.1 (Workspace actions menu).
 * Must handle: type-ahead and arrow keys (radix), a destructive item, an item with a shortcut hint,
 * disabled items, separators between groups, closing on Escape and on outside click.
 * Test first: opening the trigger lists the items; choosing one calls onSelect and closes the menu.
 */
import { DropdownMenu as Radix } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn.ts";
import { Kbd } from "./Kbd.tsx";

export const Menu = Radix.Root;
export const MenuTrigger = Radix.Trigger;
export const MenuSub = Radix.Sub;

export function MenuContent({
	className,
	sideOffset = 6,
	...rest
}: ComponentProps<typeof Radix.Content>) {
	return (
		<Radix.Portal>
			<Radix.Content
				sideOffset={sideOffset}
				className={cn(
					"z-50 min-w-48 rounded-lg bg-raised p-1 text-sm text-fg shadow-popover",
					className,
				)}
				{...rest}
			/>
		</Radix.Portal>
	);
}

export interface MenuItemProps extends ComponentProps<typeof Radix.Item> {
	/** Display form of the shortcut, from the command registry. */
	shortcut?: string;
	destructive?: boolean;
	icon?: ReactNode;
}

export function MenuItem({
	className,
	shortcut,
	destructive,
	icon,
	children,
	...rest
}: MenuItemProps) {
	return (
		<Radix.Item
			className={cn(
				"flex h-8 items-center gap-2 rounded-md px-2 outline-none",
				"data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				destructive && "text-danger",
				className,
			)}
			{...rest}
		>
			{icon ? <span className="flex size-4 items-center justify-center">{icon}</span> : null}
			<span className="flex-1 truncate">{children}</span>
			{shortcut ? <Kbd>{shortcut}</Kbd> : null}
		</Radix.Item>
	);
}

export function MenuLabel({ className, ...rest }: ComponentProps<typeof Radix.Label>) {
	return (
		<Radix.Label
			className={cn("px-2 py-1 text-xs font-medium text-fg-subtle", className)}
			{...rest}
		/>
	);
}

export function MenuSeparator({ className, ...rest }: ComponentProps<typeof Radix.Separator>) {
	return <Radix.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...rest} />;
}
