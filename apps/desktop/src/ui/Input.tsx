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
import { notImplemented } from "@conducted/shared";
import type { InputHTMLAttributes, LabelHTMLAttributes, Ref, TextareaHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	/** Message shown under the field and read with it. */
	error?: string;
	ref?: Ref<HTMLInputElement>;
}

export function Input(_props: InputProps): never {
	return notImplemented("APP-12");
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	error?: string;
	ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea(_props: TextareaProps): never {
	return notImplemented("APP-12");
}

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label(_props: LabelProps): never {
	return notImplemented("APP-12");
}
