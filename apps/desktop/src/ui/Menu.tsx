/**
 * @feature APP-05 Menu
 * Owns: dropdown menus (workspace actions, view options, open in), built on the radix DropdownMenu, including
 * checkbox items, radio groups and submenus.
 * Behaviour: ui-map.md 8 (DropdownMenu parts: CheckboxItem, RadioGroup, RadioItem, SubContent, SubTrigger),
 * 3.1 (Workspace actions menu), 5.3 (menus open from the keyboard and support submenus), 5.4 (digits 1 to 9
 * pick an item); ui-dimensions.md 4 (content: 4px padding, 8px radius, 1px ring, shadow-md, at least 128px wide;
 * item: 8px by 6px padding, 8px gap, 6px radius, text-sm, 16px icon in muted colour; shortcut hint: text-xs,
 * widest tracking, muted, 16px left padding; separator: 1px with 4px margins, bleeding 4px each side).
 * Must handle: type-ahead and arrow keys (radix), a destructive item, an item with a shortcut hint, disabled
 * items, separators between groups, checkbox and radio items that report their change, a submenu, a menu that
 * closes when the page scrolls, digits 1 to 9 that activate the matching enabled item, closing on Escape and on
 * outside click.
 * Test first: opening the trigger lists the items; choosing one calls onSelect and closes the menu.
 */
import { DropdownMenu as Radix } from "radix-ui";
import {
	type ComponentProps,
	createContext,
	type KeyboardEvent,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { cn } from "./cn.ts";
import { CheckIcon, ChevronRightIcon, DotIcon } from "./icons.tsx";

interface MenuClose {
	close: () => void;
}

const MenuCloseContext = createContext<MenuClose>({ close: () => {} });

/**
 * Tracks the open state so the content can close itself when the page scrolls. A caller that controls the
 * menu still receives `onOpenChange`; otherwise the menu keeps its own state.
 */
export function Menu({
	open: controlledOpen,
	defaultOpen = false,
	onOpenChange,
	children,
	...rest
}: ComponentProps<typeof Radix.Root>) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const controlled = controlledOpen !== undefined;
	const open = controlled ? controlledOpen : uncontrolledOpen;
	const change = (next: boolean) => {
		if (!controlled) setUncontrolledOpen(next);
		onOpenChange?.(next);
	};
	return (
		<MenuCloseContext.Provider value={{ close: () => change(false) }}>
			<Radix.Root open={open} onOpenChange={change} {...rest}>
				{children}
			</Radix.Root>
		</MenuCloseContext.Provider>
	);
}

export const MenuTrigger = Radix.Trigger;
export const MenuSub = Radix.Sub;

export const menuContentClass =
	"z-50 min-w-32 rounded-lg bg-raised p-1 text-sm text-fg shadow-popover";

export const menuItemClass =
	"flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

const indicatorClass = "flex size-4 shrink-0 items-center justify-center";

export function MenuContent({
	className,
	sideOffset = 6,
	onKeyDown,
	...rest
}: ComponentProps<typeof Radix.Content>) {
	const { close } = useContext(MenuCloseContext);

	useEffect(() => {
		const onScroll = () => close();
		document.addEventListener("scroll", onScroll, true);
		return () => document.removeEventListener("scroll", onScroll, true);
	}, [close]);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		onKeyDown?.(event);
		if (event.defaultPrevented) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (!/^[1-9]$/.test(event.key)) return;
		const items = event.currentTarget.querySelectorAll<HTMLElement>(
			'[role^="menuitem"]:not([data-disabled]):not([aria-disabled="true"])',
		);
		const item = items[Number(event.key) - 1];
		if (item === undefined) return;
		event.preventDefault();
		item.click();
	};

	return (
		<Radix.Portal>
			<Radix.Content
				sideOffset={sideOffset}
				onKeyDown={handleKeyDown}
				className={cn(menuContentClass, className)}
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
		<Radix.Item className={cn(menuItemClass, destructive && "text-danger", className)} {...rest}>
			{icon ? (
				<span className={cn(indicatorClass, !destructive && "text-fg-muted")}>{icon}</span>
			) : null}
			<span className="flex-1 truncate">{children}</span>
			{shortcut ? (
				<span className="pl-4 text-xs tracking-widest text-fg-muted">{shortcut}</span>
			) : null}
		</Radix.Item>
	);
}

export interface MenuCheckboxItemProps extends ComponentProps<typeof Radix.CheckboxItem> {
	icon?: ReactNode;
}

export function MenuCheckboxItem({ className, icon, children, ...rest }: MenuCheckboxItemProps) {
	return (
		<Radix.CheckboxItem className={cn(menuItemClass, className)} {...rest}>
			<span className={indicatorClass}>
				<Radix.ItemIndicator>{icon ?? <CheckIcon />}</Radix.ItemIndicator>
			</span>
			<span className="flex-1 truncate">{children}</span>
		</Radix.CheckboxItem>
	);
}

export const MenuRadioGroup = Radix.RadioGroup;

export interface MenuRadioItemProps extends ComponentProps<typeof Radix.RadioItem> {
	icon?: ReactNode;
}

export function MenuRadioItem({ className, icon, children, ...rest }: MenuRadioItemProps) {
	return (
		<Radix.RadioItem className={cn(menuItemClass, className)} {...rest}>
			<span className={indicatorClass}>
				<Radix.ItemIndicator>{icon ?? <DotIcon />}</Radix.ItemIndicator>
			</span>
			<span className="flex-1 truncate">{children}</span>
		</Radix.RadioItem>
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

export function MenuSubTrigger({
	className,
	children,
	...rest
}: ComponentProps<typeof Radix.SubTrigger>) {
	return (
		<Radix.SubTrigger
			className={cn(menuItemClass, "data-[state=open]:bg-hover", className)}
			{...rest}
		>
			<span className="flex-1 truncate">{children}</span>
			<span className="text-fg-muted">
				<ChevronRightIcon />
			</span>
		</Radix.SubTrigger>
	);
}

export function MenuSubContent({
	className,
	sideOffset = 6,
	...rest
}: ComponentProps<typeof Radix.SubContent>) {
	return (
		<Radix.Portal>
			<Radix.SubContent
				sideOffset={sideOffset}
				className={cn(menuContentClass, className)}
				{...rest}
			/>
		</Radix.Portal>
	);
}
