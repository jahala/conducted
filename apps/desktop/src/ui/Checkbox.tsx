/**
 * @feature APP-12 Checkbox
 * Owns: the checkbox, built on the radix Checkbox.
 * Behaviour: ui-map.md 8 (Checkbox); ui-dimensions.md 6.2 (16px box, small 14px; check icon 14px, small 12px;
 * 4px radius; check-coloured border; checked fill in check with on-check icon) and 6.3 (2px ring with 2px
 * offset on focus).
 * Must handle: checked, unchecked and indeterminate; disabled; a label that toggles it on click; Space
 * toggles from the keyboard.
 * Test first: clicking its label calls onCheckedChange(true).
 */
import { notImplemented } from "@conducted/shared";

export interface CheckboxProps {
	checked: boolean | "indeterminate";
	onCheckedChange: (checked: boolean) => void;
	id?: string;
	disabled?: boolean;
	size?: "sm" | "md";
	"aria-label"?: string;
}

export function Checkbox(_props: CheckboxProps): never {
	return notImplemented("APP-12");
}
