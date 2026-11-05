/**
 * @feature APP-12 Input, Textarea and Label
 * Owns: the text field, the multi-line field and the label every form uses.
 * Behaviour: ui-map.md 8 (form controls); ui-dimensions.md 6.2 (input 32px tall, 12px sides, 8px top and
 * bottom, text-sm, 6px radius, 1px border-strong edge, and on focus the edge turns the accent; textarea at
 * least 60px with the same padding and focus rule; label text-sm medium with line height 1).
 * Our design choice (D023): the field keeps the global focus ring as well as the accent edge, so focus stays
 * visible for every control.
 * Must handle: width sized to the expected input (callers pass it), placeholder in fg-subtle, disabled and
 * read-only states, an error state with its message linked by aria-describedby, a label tied to its field.
 * Test first: a Label with htmlFor names its Input, and the Input shows the accent edge class on focus.
 */

import type { InputHTMLAttributes, LabelHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";
import { useId, useState } from "react";
import { cn } from "./cn.ts";

const fieldClass =
	"rounded-md border bg-transparent text-sm text-fg transition-colors placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-muted";

function edgeClass(focused: boolean, error: string | undefined): string {
	if (error) return "border-danger";
	return focused ? "border-accent" : "border-border-strong";
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	/** Message shown under the field and read with it. */
	error?: string;
	ref?: Ref<HTMLInputElement>;
}

export function Input({
	error,
	className,
	id,
	ref,
	onFocus,
	onBlur,
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	...rest
}: InputProps) {
	const [focused, setFocused] = useState(false);
	const generatedId = useId();
	const errorId = `${id ?? generatedId}-error`;
	const describedBy = error
		? [ariaDescribedBy, errorId].filter(Boolean).join(" ")
		: ariaDescribedBy;

	return (
		<>
			<input
				id={id}
				ref={ref}
				aria-invalid={error ? true : ariaInvalid}
				aria-describedby={describedBy}
				className={cn(fieldClass, "h-8 px-3", edgeClass(focused, error), className)}
				onFocus={(event) => {
					setFocused(true);
					onFocus?.(event);
				}}
				onBlur={(event) => {
					setFocused(false);
					onBlur?.(event);
				}}
				{...rest}
			/>
			{error ? (
				<p id={errorId} className="mt-1 text-xs text-danger">
					{error}
				</p>
			) : null}
		</>
	);
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	error?: string;
	ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({
	error,
	className,
	id,
	ref,
	onFocus,
	onBlur,
	"aria-describedby": ariaDescribedBy,
	"aria-invalid": ariaInvalid,
	...rest
}: TextareaProps) {
	const [focused, setFocused] = useState(false);
	const generatedId = useId();
	const errorId = `${id ?? generatedId}-error`;
	const describedBy = error
		? [ariaDescribedBy, errorId].filter(Boolean).join(" ")
		: ariaDescribedBy;

	return (
		<>
			<textarea
				id={id}
				ref={ref}
				aria-invalid={error ? true : ariaInvalid}
				aria-describedby={describedBy}
				className={cn(fieldClass, "min-h-15 px-3 py-2", edgeClass(focused, error), className)}
				onFocus={(event) => {
					setFocused(true);
					onFocus?.(event);
				}}
				onBlur={(event) => {
					setFocused(false);
					onBlur?.(event);
				}}
				{...rest}
			/>
			{error ? (
				<p id={errorId} className="mt-1 text-xs text-danger">
					{error}
				</p>
			) : null}
		</>
	);
}

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...rest }: LabelProps) {
	// biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor or nest their field.
	return <label className={cn("text-sm font-medium leading-none text-fg", className)} {...rest} />;
}
