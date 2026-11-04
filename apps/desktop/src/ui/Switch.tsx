/**
 * @feature APP-12 Switch
 * Owns: the on and off switch for settings, built on the radix Switch.
 * Behaviour: ui-map.md 8 (Switch); ui-dimensions.md 6.2 (track 40px by 20px, fully round; 16px thumb with the
 * dialog shadow, 1px in when off and moved 21px when on; on track switch-on, off track border-strong; thumb
 * switch-thumb; 150ms) and 6.3 (2px ring with 2px offset on focus).
 * Must handle: disabled, a label that names it, reduced motion (no slide), Space and Enter toggle.
 * Test first: pressing Space on a focused switch calls onCheckedChange with the opposite value.
 */
import { notImplemented } from "@conducted/shared";

export interface SwitchProps {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	id?: string;
	disabled?: boolean;
	"aria-label"?: string;
}

export function Switch(_props: SwitchProps): never {
	return notImplemented("APP-12");
}
