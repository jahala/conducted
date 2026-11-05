/**
 * @feature APP-05 ContextMenu
 * Owns: right-click menus (workspace row, chat tab, file row), built on the radix ContextMenu with the same
 * look as Menu.tsx, and the item parts those menus use.
 * Behaviour: ui-map.md 5.3 (context menus), 8 (ContextMenu parts: CheckboxItem, Content, Item, Label, RadioItem,
 * Separator, SubContent, SubTrigger, Trigger).
 * Must handle: the same items as the matching dropdown (one list, two surfaces), keyboard open with the
 * context-menu key, a destructive item, checkbox and radio items, submenus, closing on scroll.
 * Test first: a right click on the trigger opens the menu with its items.
 */
import { ContextMenu as Radix } from "radix-ui";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "./cn.ts";
import { menuContentClass, menuItemClass } from "./Menu.tsx";

export interface ContextMenuProps {
	/** The element that opens the menu on right click. */
	children: ReactElement;
	/** The menu items, built from the parts below. */
	items: ReactNode;
	className?: string;
}

export function ContextMenu({ children, items, className }: ContextMenuProps) {
	return (
		<Radix.Root>
			<Radix.Trigger asChild>{children}</Radix.Trigger>
			<Radix.Portal>
				<Radix.Content className={cn(menuContentClass, className)}>{items}</Radix.Content>
			</Radix.Portal>
		</Radix.Root>
	);
}

export const ContextMenuTrigger = Radix.Trigger;
export const ContextMenuSub = Radix.Sub;
export const ContextMenuRadioGroup = Radix.RadioGroup;

export function ContextMenuContent({ className, ...rest }: ComponentProps<typeof Radix.Content>) {
	return (
		<Radix.Portal>
			<Radix.Content className={cn(menuContentClass, className)} {...rest} />
		</Radix.Portal>
	);
}

export function ContextMenuItem({
	className,
	destructive,
	...rest
}: ComponentProps<typeof Radix.Item> & { destructive?: boolean }) {
	return (
		<Radix.Item className={cn(menuItemClass, destructive && "text-danger", className)} {...rest} />
	);
}

export function ContextMenuCheckboxItem({
	className,
	...rest
}: ComponentProps<typeof Radix.CheckboxItem>) {
	return <Radix.CheckboxItem className={cn(menuItemClass, className)} {...rest} />;
}

export function ContextMenuRadioItem({
	className,
	...rest
}: ComponentProps<typeof Radix.RadioItem>) {
	return <Radix.RadioItem className={cn(menuItemClass, className)} {...rest} />;
}

export function ContextMenuLabel({ className, ...rest }: ComponentProps<typeof Radix.Label>) {
	return (
		<Radix.Label
			className={cn("px-2 py-1 text-xs font-medium text-fg-subtle", className)}
			{...rest}
		/>
	);
}

export function ContextMenuSeparator({
	className,
	...rest
}: ComponentProps<typeof Radix.Separator>) {
	return <Radix.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...rest} />;
}

export function ContextMenuSubTrigger({
	className,
	...rest
}: ComponentProps<typeof Radix.SubTrigger>) {
	return (
		<Radix.SubTrigger
			className={cn(menuItemClass, "data-[state=open]:bg-hover", className)}
			{...rest}
		/>
	);
}

export function ContextMenuSubContent({
	className,
	...rest
}: ComponentProps<typeof Radix.SubContent>) {
	return (
		<Radix.Portal>
			<Radix.SubContent className={cn(menuContentClass, className)} {...rest} />
		</Radix.Portal>
	);
}
