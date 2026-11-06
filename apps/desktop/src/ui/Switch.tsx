/**
 * @feature APP-12 Switch
 * Owns: the on and off switch for settings, built on the radix Switch.
 * Behaviour: ui-map.md 8 (Switch); ui-dimensions.md 6.2 (track 40px by 20px, fully round; 16px thumb with the
 * dialog shadow, 1px in when off and moved 21px when on; on track switch-on, off track border-strong; thumb
 * switch-thumb; 150ms) and 6.3 (2px ring with 2px offset on focus).
 * Must handle: disabled, a label that names it, reduced motion (no slide), Space and Enter toggle.
 * Test first: pressing Space on a focused switch calls onCheckedChange with the opposite value.
 */
import { Switch as Radix } from "radix-ui";
import { cn } from "./cn.ts";

export interface SwitchProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	id?: string;
	disabled?: boolean;
	"aria-label"?: string;
}

export function Switch({
	checked,
	onCheckedChange,
	id,
	disabled = false,
	"aria-label": ariaLabel,
}: SwitchProps) {
	return (
		<Radix.Root
			id={id}
			checked={checked}
			disabled={disabled}
			aria-label={ariaLabel}
			onCheckedChange={onCheckedChange}
			onKeyDown={(event) => {
				if (event.key !== " " && event.key !== "Enter") return;
				event.preventDefault();
				if (!disabled) onCheckedChange(!checked);
			}}
			className={cn(
				"relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
				"data-[state=checked]:border-switch-on data-[state=checked]:bg-switch-on",
				"data-[state=unchecked]:border-border-strong data-[state=unchecked]:bg-chip-border",
				"disabled:cursor-not-allowed disabled:opacity-50",
			)}
		>
			<Radix.Thumb
				className={cn(
					"block size-4 rounded-full bg-switch-thumb shadow-dialog transition-transform",
					"data-[state=checked]:translate-x-[21px] data-[state=unchecked]:translate-x-px",
				)}
			/>
		</Radix.Root>
	);
}
