/**
 * @feature APP-12 Slider
 * Owns: the slider used for app zoom, built on the radix Slider.
 * Behaviour: ui-map.md 6 (Appearance: app zoom with a reset), 8 (Slider); ui-dimensions.md 6.2 (track 6px tall
 * in check at 20%; 16px thumb with a check border at 50%).
 * Must handle: min, max and step from the caller; arrow keys and Page keys step the value; the value is read
 * out with its unit (aria-valuetext); a visible focus ring on the thumb; disabled.
 * Test first: pressing ArrowRight on the thumb calls onValueChange with value plus step.
 */
import { notImplemented } from "@conducted/shared";

export interface SliderProps {
	value: number;
	min: number;
	max: number;
	step: number;
	onValueChange: (value: number) => void;
	/** Text read for the current value, such as "110%". */
	formatValue: (value: number) => string;
	"aria-label": string;
	disabled?: boolean;
}

export function Slider(_props: SliderProps): never {
	return notImplemented("APP-12");
}
