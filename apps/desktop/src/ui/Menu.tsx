/**
 * @feature APP-05 Menu
 * Owns: dropdown menus (workspace actions, view options, open in), built on the radix DropdownMenu, including
 * checkbox items, radio groups and submenus. The item parts and their classes are shared with ContextMenu.tsx.
 * Behaviour: ui-map.md 8 (DropdownMenu parts: CheckboxItem, RadioGroup, RadioItem, SubContent, SubTrigger),
 * 3.1 (Workspace actions menu), 5.3 (menus open from the keyboard and support submenus), 5.4 (digits 1 to 9
 * pick an item); ui-dimensions.md 4 (content: 4px padding, 8px radius, 1px ring, shadow-md, at least 128px wide;
 * item: 8px by 6px padding, 8px gap, 6px radius, text-sm, 16px icon in muted colour; shortcut hint: text-xs,
 * widest tracking, muted, 16px left padding; separator: 1px with 4px margins, bleeding 4px each side).
 * Must handle: type-ahead and arrow keys (radix), a destructive item, an item with a shortcut hint, disabled
 * items, separators between groups, checkbox and radio items that report their change, a submenu, a menu that
 * closes when the page scrolls, digits 1 to 9 that activate the matching enabled item, closing on Escape and on
 * outside click, a caller's aria-label naming the menu in place of the trigger's label.
 * Test first: opening the trigger lists the items; choosing one calls onSelect and closes the menu.
 */
import { DropdownMenu as Radix } from "radix-ui";
import {
	type ComponentProps,
	createContext,
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "./cn.ts";
import { CheckIcon, ChevronRightIcon, DotIcon } from "./icons.tsx";

interface MenuClose {
	close: () => void;
}

const MenuCloseContext = createContext<MenuClose>({ close: () => {} });

interface MenuOpenStateOptions {
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/**
 * The open state of one menu. A caller that controls the menu still receives `onOpenChange`; otherwise the
 * menu keeps its own state. `close` is what the content parts use to dismiss the menu.
 */
export function useMenuOpenState({
	open: controlledOpen,
	defaultOpen = false,
	onOpenChange,
}: MenuOpenStateOptions) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const controlled = controlledOpen !== undefined;
	const open = controlled ? controlledOpen : uncontrolledOpen;
	const change = useCallback(
		(next: boolean) => {
			if (!controlled) setUncontrolledOpen(next);
			onOpenChange?.(next);
		},
		[controlled, onOpenChange],
	);
	const close = useCallback(() => change(false), [change]);
	return { open, change, close };
}

export function MenuCloseProvider({ close, children }: { close: () => void; children: ReactNode }) {
	return <MenuCloseContext.Provider value={{ close }}>{children}</MenuCloseContext.Provider>;
}

export function Menu({
	open: controlledOpen,
	defaultOpen = false,
	onOpenChange,
	children,
	...rest
}: ComponentProps<typeof Radix.Root>) {
	const state = useMenuOpenState({ open: controlledOpen, defaultOpen, onOpenChange });
	return (
		<MenuCloseProvider close={state.close}>
			<Radix.Root open={state.open} onOpenChange={state.change} {...rest}>
				{children}
			</Radix.Root>
		</MenuCloseProvider>
	);
}

export const MenuTrigger = Radix.Trigger;
export const MenuSub = Radix.Sub;

export const menuContentClass =
	"z-50 min-w-32 rounded-lg bg-raised p-1 text-sm text-fg shadow-popover";

export const menuItemClass =
	"flex items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const menuItemDestructiveClass = "text-danger";
export const menuLabelClass = "px-2 py-1 text-xs font-medium text-fg-subtle";
export const menuSeparatorClass = "-mx-1 my-1 h-px bg-border";
export const menuSubTriggerClass = "data-[state=open]:bg-hover";
export const menuIndicatorClass = "flex size-4 shrink-0 items-center justify-center";

/**
 * The parts inside a menu item. Menu.tsx and ContextMenu.tsx use these so the same list can render on both
 * surfaces without copying the layout.
 */
export function MenuItemContents({
	icon,
	shortcut,
	destructive,
	children,
}: {
	icon?: ReactNode;
	shortcut?: string;
	destructive?: boolean;
	children?: ReactNode;
}) {
	return (
		<>
			{icon ? (
				<span className={cn(menuIndicatorClass, !destructive && "text-fg-muted")}>{icon}</span>
			) : null}
			<span className="flex-1 truncate">{children}</span>
			{shortcut ? (
				<span className="pl-4 text-xs tracking-widest text-fg-muted">{shortcut}</span>
			) : null}
		</>
	);
}

export function MenuChoiceItemContents({
	indicator,
	children,
}: {
	indicator: ReactNode;
	children?: ReactNode;
}) {
	return (
		<>
			<span className={menuIndicatorClass}>{indicator}</span>
			<span className="flex-1 truncate">{children}</span>
		</>
	);
}

export function MenuSubTriggerContents({ children }: { children?: ReactNode }) {
	return (
		<>
			<span className="flex-1 truncate">{children}</span>
			<span className="text-fg-muted">
				<ChevronRightIcon />
			</span>
		</>
	);
}

interface MenuContentBehaviour {
	contentRef: (node: HTMLDivElement | null) => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * The behaviour every menu content shares: close when the page around it scrolls, and let digits 1 to 9
 * activate the matching enabled item. Scrolls and keys inside the content itself belong to the menu.
 */
export function useMenuContentBehaviour(
	forwardedRef?: Ref<HTMLDivElement>,
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void,
): MenuContentBehaviour {
	const { close } = useContext(MenuCloseContext);
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const onScroll = (event: Event) => {
			const target = event.target;
			if (target instanceof Element && target.closest('[role="menu"]') !== null) return;
			if (target instanceof Node && contentRef.current?.contains(target)) return;
			close();
		};
		document.addEventListener("scroll", onScroll, true);
		return () => document.removeEventListener("scroll", onScroll, true);
	}, [close]);

	const setContentRef = useCallback(
		(node: HTMLDivElement | null) => {
			contentRef.current = node;
			if (typeof forwardedRef === "function") forwardedRef(node);
			else if (forwardedRef) forwardedRef.current = node;
		},
		[forwardedRef],
	);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		onKeyDown?.(event);
		if (event.defaultPrevented) return;
		const target = event.target;
		if (!(target instanceof Node) || !event.currentTarget.contains(target)) return;
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

	return { contentRef: setContentRef, onKeyDown: handleKeyDown };
}

/**
 * The dropdown's content. Radix names the menu after its trigger with aria-labelledby, which hides
 * an aria-label the caller passes; a caller's aria-label names the menu instead.
 */
export function MenuContent({
	className,
	sideOffset = 6,
	collisionPadding = 8,
	onKeyDown,
	ref,
	...rest
}: ComponentProps<typeof Radix.Content>) {
	const behaviour = useMenuContentBehaviour(ref, onKeyDown);
	const labelledBy =
		rest["aria-label"] === undefined ? {} : { "aria-labelledby": rest["aria-labelledby"] };

	return (
		<Radix.Portal>
			<Radix.Content
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				ref={behaviour.contentRef}
				onKeyDown={behaviour.onKeyDown}
				className={cn(menuContentClass, className)}
				{...rest}
				{...labelledBy}
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
			className={cn(menuItemClass, destructive && menuItemDestructiveClass, className)}
			{...rest}
		>
			<MenuItemContents icon={icon} shortcut={shortcut} destructive={destructive}>
				{children}
			</MenuItemContents>
		</Radix.Item>
	);
}

export interface MenuCheckboxItemProps extends ComponentProps<typeof Radix.CheckboxItem> {
	icon?: ReactNode;
}

export function MenuCheckboxItem({ className, icon, children, ...rest }: MenuCheckboxItemProps) {
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

export const MenuRadioGroup = Radix.RadioGroup;

export interface MenuRadioItemProps extends ComponentProps<typeof Radix.RadioItem> {
	icon?: ReactNode;
}

export function MenuRadioItem({ className, icon, children, ...rest }: MenuRadioItemProps) {
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

export function MenuLabel({ className, ...rest }: ComponentProps<typeof Radix.Label>) {
	return <Radix.Label className={cn(menuLabelClass, className)} {...rest} />;
}

export function MenuSeparator({ className, ...rest }: ComponentProps<typeof Radix.Separator>) {
	return <Radix.Separator className={cn(menuSeparatorClass, className)} {...rest} />;
}

export function MenuSubTrigger({
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

export function MenuSubContent({
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
