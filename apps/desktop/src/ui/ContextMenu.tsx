/**
 * @feature APP-05 ContextMenu
 * Owns: right-click menus (workspace row, chat tab, file row), built on the radix ContextMenu with the same
 * look and the same item parts as Menu.tsx, so one list can render on both surfaces.
 * Behaviour: ui-map.md 5.3 (context menus), 8 (ContextMenu parts: CheckboxItem, Content, Item, Label, RadioItem,
 * Separator, SubContent, SubTrigger, Trigger).
 * Must handle: keyboard open with the context-menu key, a destructive item, an item with an icon and a
 * shortcut hint, checkbox and radio items, submenus, closing on scroll, digits 1 to 9 that activate the
 * matching enabled item.
 * Test first: a right click on the trigger opens the menu with its items.
 */
import { ContextMenu as Radix } from "radix-ui";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { cn } from "./cn.ts";
import { CheckIcon, DotIcon } from "./icons.tsx";
import {
	MenuChoiceItemContents,
	MenuCloseProvider,
	MenuItemContents,
	MenuSubTriggerContents,
	menuContentClass,
	menuItemClass,
	menuItemDestructiveClass,
	menuLabelClass,
	menuSeparatorClass,
	menuSubTriggerClass,
	useMenuContentBehaviour,
	useMenuOpenState,
} from "./Menu.tsx";

export interface ContextMenuProps extends Omit<ComponentProps<typeof Radix.Root>, "children"> {
	/** The element that opens the menu on right click. */
	children: ReactElement;
	/** The menu items, built from the parts below. */
	items: ReactNode;
	className?: string;
	/** Whether the menu starts open when the caller does not control it. */
	defaultOpen?: boolean;
}

function ContextMenuContent({ items, className }: Pick<ContextMenuProps, "items" | "className">) {
	const behaviour = useMenuContentBehaviour();

	return (
		<Radix.Portal>
			<Radix.Content
				ref={behaviour.contentRef}
				onKeyDown={behaviour.onKeyDown}
				className={cn(menuContentClass, className)}
			>
				{items}
			</Radix.Content>
		</Radix.Portal>
	);
}

export function ContextMenu({
	children,
	items,
	className,
	open: controlledOpen,
	defaultOpen = false,
	onOpenChange,
	...rest
}: ContextMenuProps) {
	const state = useMenuOpenState({ open: controlledOpen, defaultOpen, onOpenChange });

	return (
		<MenuCloseProvider close={state.close}>
			<Radix.Root open={state.open} onOpenChange={state.change} {...rest}>
				<Radix.Trigger
					asChild
					onKeyDown={(event) => {
						if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
						event.preventDefault();
						const rect = event.currentTarget.getBoundingClientRect();
						event.currentTarget.dispatchEvent(
							new MouseEvent("contextmenu", {
								bubbles: true,
								cancelable: true,
								clientX: rect.left,
								clientY: rect.top,
							}),
						);
					}}
				>
					{children}
				</Radix.Trigger>
				<ContextMenuContent items={items} className={className} />
			</Radix.Root>
		</MenuCloseProvider>
	);
}

export const ContextMenuSub = Radix.Sub;
export const ContextMenuRadioGroup = Radix.RadioGroup;

export interface ContextMenuItemProps extends ComponentProps<typeof Radix.Item> {
	/** Display form of the shortcut, from the command registry. */
	shortcut?: string;
	destructive?: boolean;
	icon?: ReactNode;
}

export function ContextMenuItem({
	className,
	shortcut,
	destructive,
	icon,
	children,
	...rest
}: ContextMenuItemProps) {
	return (
		<Radix.Item
			className={cn(menuItemClass, destructive && menuItemDestructiveClass, className)}
			{...rest}
		>
			<MenuItemContents icon={icon} shortcut={shortcut} destructive={destructive}>
				{children}
			</MenuItemContents>
		</Radix.Item>
	);
}

export interface ContextMenuCheckboxItemProps extends ComponentProps<typeof Radix.CheckboxItem> {
	icon?: ReactNode;
}

export function ContextMenuCheckboxItem({
	className,
	icon,
	children,
	...rest
}: ContextMenuCheckboxItemProps) {
	return (
		<Radix.CheckboxItem className={cn(menuItemClass, className)} {...rest}>
			<MenuChoiceItemContents
				indicator={<Radix.ItemIndicator>{icon ?? <CheckIcon />}</Radix.ItemIndicator>}
			>
				{children}
			</MenuChoiceItemContents>
		</Radix.CheckboxItem>
	);
}

export interface ContextMenuRadioItemProps extends ComponentProps<typeof Radix.RadioItem> {
	icon?: ReactNode;
}

export function ContextMenuRadioItem({
	className,
	icon,
	children,
	...rest
}: ContextMenuRadioItemProps) {
	return (
		<Radix.RadioItem className={cn(menuItemClass, className)} {...rest}>
			<MenuChoiceItemContents
				indicator={<Radix.ItemIndicator>{icon ?? <DotIcon />}</Radix.ItemIndicator>}
			>
				{children}
			</MenuChoiceItemContents>
		</Radix.RadioItem>
	);
}

export function ContextMenuLabel({ className, ...rest }: ComponentProps<typeof Radix.Label>) {
	return <Radix.Label className={cn(menuLabelClass, className)} {...rest} />;
}

export function ContextMenuSeparator({
	className,
	...rest
}: ComponentProps<typeof Radix.Separator>) {
	return <Radix.Separator className={cn(menuSeparatorClass, className)} {...rest} />;
}

export function ContextMenuSubTrigger({
	className,
	children,
	...rest
}: ComponentProps<typeof Radix.SubTrigger>) {
	return (
		<Radix.SubTrigger className={cn(menuItemClass, menuSubTriggerClass, className)} {...rest}>
			<MenuSubTriggerContents>{children}</MenuSubTriggerContents>
		</Radix.SubTrigger>
	);
}

export function ContextMenuSubContent({
	className,
	sideOffset = 6,
	onKeyDown,
	ref,
	...rest
}: ComponentProps<typeof Radix.SubContent>) {
	const behaviour = useMenuContentBehaviour(ref, onKeyDown);

	return (
		<Radix.Portal>
			<Radix.SubContent
				sideOffset={sideOffset}
				ref={behaviour.contentRef}
				onKeyDown={behaviour.onKeyDown}
				className={cn(menuContentClass, className)}
				{...rest}
			/>
		</Radix.Portal>
	);
}
