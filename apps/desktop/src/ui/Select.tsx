/**
 * @feature APP-12 Select
 * Owns: the drop-down choice control used by settings and pickers, built on the radix Select.
 * Behaviour: ui-map.md 8 (Select); ui-dimensions.md 6.2 (trigger 32px tall, 12px left and 10px right padding,
 * 4px gap, 6px radius, 12px chevron) and 4 (popup items: 6px top and bottom, 8px left, 32px right for the
 * check mark; popup has the menu's ring and shadow).
 * Must handle: keyboard selection and type-ahead (radix), a value not in the options (shown as is, never
 * dropped), a disabled option, a long list scrolling inside the popup, a visible focus ring on the trigger.
 * Test first: choosing an option from the keyboard calls onValueChange with its value.
 */
import { notImplemented } from "@conducted/shared";

export interface SelectOption<T extends string> {
	value: T;
	label: string;
	disabled?: boolean;
}

export interface SelectProps<T extends string> {
	value: T;
	options: readonly SelectOption<T>[];
	onValueChange: (value: T) => void;
	/** Accessible name when no visible Label points at the trigger. */
	"aria-label"?: string;
	id?: string;
	disabled?: boolean;
	size?: "sm" | "md";
}

export function Select<T extends string>(_props: SelectProps<T>): never {
	return notImplemented("APP-12");
}
