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
import { Checkbox as Radix } from "radix-ui";
import { cn } from "./cn.ts";
import { CheckIcon } from "./icons.tsx";

export interface CheckboxProps {
	checked: boolean | "indeterminate";
	onCheckedChange: (checked: boolean) => void;
	id?: string;
	disabled?: boolean;
	size?: "sm" | "md";
	"aria-label"?: string;
}

export function Checkbox({
	checked,
	onCheckedChange,
	id,
	disabled = false,
	size = "md",
	"aria-label": ariaLabel,
}: CheckboxProps) {
	const indeterminate = checked === "indeterminate";

	return (
		<Radix.Root
			id={id}
			checked={checked}
			disabled={disabled}
			aria-label={ariaLabel}
			onCheckedChange={(next) => onCheckedChange(next === true)}
			onKeyDown={(event) => {
				if (event.key !== " ") return;
				event.preventDefault();
				if (!disabled) onCheckedChange(indeterminate ? true : !checked);
			}}
			className={cn(
				"flex shrink-0 items-center justify-center rounded-sm border border-check bg-transparent text-on-check transition-colors",
				size === "sm" ? "size-3.5" : "size-4",
				"data-[state=checked]:bg-check data-[state=indeterminate]:bg-check",
				"disabled:cursor-not-allowed disabled:opacity-50",
			)}
		>
			<Radix.Indicator className="pointer-events-none flex items-center justify-center">
				{indeterminate ? (
					<span className="h-0.5 w-2 rounded-full bg-on-check" />
				) : (
					<CheckIcon className={size === "sm" ? "size-3" : "size-3.5"} />
				)}
			</Radix.Indicator>
		</Radix.Root>
	);
}
