/**
 * @feature APP-12 Select
 * Owns: the drop-down choice control used by settings and pickers, built on the radix Select.
 * Behaviour: ui-map.md 8 (Select); ui-dimensions.md 6.2 (trigger 32px tall, 12px left and 10px right padding,
 * 4px gap, 6px radius, 12px chevron) and 4 (popup items: 6px top and bottom, 8px left, 32px right for the
 * check mark; popup has the menu's ring and shadow).
 * Must handle: keyboard selection and type-ahead (radix), a value not in the options (shown as is, never
 * dropped), a disabled option, options listed under group names (a cloud workspace's Cloud and Local
 * action variants, CLOUD-09), a long list scrolling inside the popup, a visible focus ring on the trigger.
 * Test first: choosing an option from the keyboard calls onValueChange with its value.
 */
import { Select as Radix } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "./cn.ts";
import { CheckIcon, ChevronDownIcon, ChevronsUpDownIcon } from "./icons.tsx";
import { menuContentClass } from "./Menu.tsx";

export interface SelectOption<T extends string> {
	value: T;
	label: string;
	disabled?: boolean;
	/** Options that share a group are listed under its name, in first-seen order. */
	group?: string;
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
	/**
	 * "ghost" is Conductor's toolbar select (Home's archive filter and sort): no border, muted text, an
	 * optional leading icon and a small down chevron.
	 */
	variant?: "outline" | "ghost";
	/** A leading icon, drawn by the ghost variant. */
	icon?: ReactNode;
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
	variant = "outline",
	icon,
}: SelectProps<T>) {
	const selected = options.find((option) => option.value === value);
	const item = (option: SelectOption<T>) => (
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
	);
	const grouped = options.some((option) => option.group !== undefined);
	const groups: { label: string | null; options: SelectOption<T>[] }[] = [];
	if (grouped) {
		// One section per group, in first-seen order, so options of one group stay together.
		const byGroup = new Map<string | null, SelectOption<T>[]>();
		for (const option of options) {
			const label = option.group ?? null;
			const bucket = byGroup.get(label);
			if (bucket === undefined) byGroup.set(label, [option]);
			else bucket.push(option);
		}
		for (const [label, entries] of byGroup) groups.push({ label, options: entries });
	}

	return (
		<Radix.Root
			value={encode(value)}
			disabled={disabled}
			onValueChange={(next) => onValueChange(decode(next) as T)}
		>
			{variant === "ghost" ? (
				<Radix.Trigger
					id={id}
					aria-label={ariaLabel}
					className={cn(
						"inline-flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-md bg-transparent px-2 text-sm text-fg-muted outline-none transition-colors",
						"hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:text-fg disabled:cursor-not-allowed disabled:opacity-50",
						className,
					)}
				>
					{icon}
					<span className="truncate">
						<Radix.Value>{selected?.label ?? value}</Radix.Value>
					</span>
					<Radix.Icon asChild>
						<ChevronDownIcon className="size-3 shrink-0" />
					</Radix.Icon>
				</Radix.Trigger>
			) : (
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
			)}
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
						{grouped
							? groups.map((group, index) =>
									group.label === null ? (
										group.options.map(item)
									) : (
										<Radix.Group key={group.label} className={cn(index > 0 && "mt-1")}>
											<Radix.Label className="px-2 py-1 text-xs text-fg-subtle">
												{group.label}
											</Radix.Label>
											{group.options.map(item)}
										</Radix.Group>
									),
								)
							: options.map(item)}
					</Radix.Viewport>
					<Radix.ScrollDownButton className="flex h-6 items-center justify-center text-fg-muted">
						<ChevronDownIcon className="size-3" />
					</Radix.ScrollDownButton>
				</Radix.Content>
			</Radix.Portal>
		</Radix.Root>
	);
}
