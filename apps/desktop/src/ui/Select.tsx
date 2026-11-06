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
import { Select as Radix } from "radix-ui";
import { cn } from "./cn.ts";
import { CheckIcon, ChevronDownIcon, ChevronsUpDownIcon } from "./icons.tsx";
import { menuContentClass } from "./Menu.tsx";

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
	/** Extra classes on the trigger, such as a fixed width. */
	className?: string;
}

/**
 * Radix reserves the empty string for "nothing chosen", so an option whose value is "" (Automatic, No
 * section) would show a blank trigger and could not be picked. Inside the control it travels as this
 * marker instead; callers still see "".
 */
const EMPTY_VALUE = "\u0000empty";
const encode = (value: string) => (value === "" ? EMPTY_VALUE : value);
const decode = (value: string) => (value === EMPTY_VALUE ? "" : value);

export function Select<T extends string>({
	value,
	options,
	onValueChange,
	"aria-label": ariaLabel,
	id,
	disabled = false,
	size = "md",
	className,
}: SelectProps<T>) {
	const selected = options.find((option) => option.value === value);

	return (
		<Radix.Root
			value={encode(value)}
			disabled={disabled}
			onValueChange={(next) => onValueChange(decode(next) as T)}
		>
			<Radix.Trigger
				id={id}
				aria-label={ariaLabel}
				className={cn(
					"inline-flex items-center justify-between gap-1 rounded-md border border-border-strong bg-transparent text-fg transition-colors",
					"hover:bg-hover focus:border-accent disabled:cursor-not-allowed disabled:opacity-50",
					size === "sm" ? "h-7 pl-2.5 pr-2 text-xs" : "h-8 pl-3 pr-2.5 text-sm",
					className,
				)}
			>
				<Radix.Value>{selected?.label ?? value}</Radix.Value>
				<Radix.Icon asChild>
					<ChevronsUpDownIcon className="size-3 shrink-0 text-fg-muted" />
				</Radix.Icon>
			</Radix.Trigger>
			<Radix.Portal>
				<Radix.Content
					position="popper"
					sideOffset={4}
					className={cn(
						menuContentClass,
						"max-h-[var(--radix-select-content-available-height)] overflow-hidden",
					)}
				>
					<Radix.ScrollUpButton className="flex h-6 items-center justify-center text-fg-muted">
						<ChevronDownIcon className="size-3 rotate-180" />
					</Radix.ScrollUpButton>
					<Radix.Viewport className="overflow-y-auto">
						{options.map((option) => (
							<Radix.Item
								key={option.value}
								value={encode(option.value)}
								disabled={option.disabled}
								className={cn(
									"relative flex w-full items-center rounded-md py-1.5 pl-2 pr-8 text-sm outline-none",
									"data-[highlighted]:bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
								)}
							>
								<Radix.ItemText>{option.label}</Radix.ItemText>
								<span className="absolute right-2 flex size-4 items-center justify-center">
									<Radix.ItemIndicator>
										<CheckIcon className="size-4" />
									</Radix.ItemIndicator>
								</span>
							</Radix.Item>
						))}
					</Radix.Viewport>
					<Radix.ScrollDownButton className="flex h-6 items-center justify-center text-fg-muted">
						<ChevronDownIcon className="size-3" />
					</Radix.ScrollDownButton>
				</Radix.Content>
			</Radix.Portal>
		</Radix.Root>
	);
}
