/**
 * @feature APP-12 Slider
 * Owns: the slider used for app zoom, built on the radix Slider.
 * Behaviour: ui-map.md 6 (Appearance: app zoom with a reset), 8 (Slider); ui-dimensions.md 6.2 (track 6px tall
 * in check at 20%; 16px thumb with a check border at 50%).
 * Must handle: min, max and step from the caller; arrow keys and Page keys step the value; the value is read
 * out with its unit (aria-valuetext); a visible focus ring on the thumb; disabled.
 * Test first: pressing ArrowRight on the thumb calls onValueChange with value plus step.
 */
import { Slider as Radix } from "radix-ui";
import { cn } from "./cn.ts";

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

export function Slider({
	value,
	min,
	max,
	step,
	onValueChange,
	formatValue,
	"aria-label": ariaLabel,
	disabled = false,
}: SliderProps) {
	return (
		<Radix.Root
			value={[value]}
			min={min}
			max={max}
			step={step}
			disabled={disabled}
			onValueChange={(next) => {
				const first = next[0];
				if (first !== undefined) onValueChange(first);
			}}
			className={cn(
				"relative flex w-full touch-none select-none items-center",
				"data-[disabled]:opacity-50",
			)}
		>
			<Radix.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-check/20">
				<Radix.Range className="absolute h-full rounded-full bg-check" />
			</Radix.Track>
			<Radix.Thumb
				aria-label={ariaLabel}
				aria-valuetext={formatValue(value)}
				className={cn(
					"block size-4 shrink-0 rounded-full border border-check/50 bg-canvas shadow-sm",
					"disabled:cursor-not-allowed",
				)}
			/>
		</Radix.Root>
	);
}
