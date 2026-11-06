/**
 * @feature APP-13 CopyButton
 * Owns: the one copy button used by code blocks, diagnostics, paths and logs, with its short confirmation.
 * Behaviour: ui-map.md 8 (SimpleCopyButton); ui-map.md 3.3 (code blocks copy), 2 (diagnostics copy).
 * Our design choice: the caller supplies the copy action, so the kit never reaches the Platform itself. The
 * label changes from "Copy" to "Copied" for a moment (1.5s by default) and back. A copy that fails, by throwing
 * or by returning a failed `Result`, leaves the label alone and shows an error toast: a screen never claims
 * something the clipboard did not take, and the user is told it did not.
 * Must handle: an asynchronous copy; a second copy inside the confirmation window (it restarts the timer);
 * unmounting while the timer runs (it is cleared); a caller that styles the button or gives it a name.
 * Test first: clicking calls onCopy with the button's text, shows "Copied", then returns to "Copy".
 */
import { messageOf } from "@conducted/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "./Button.tsx";
import { toastError } from "./Toast.tsx";

/** The error of a copy that failed, or null when it worked. The copy action may return a `Result`. */
function copyFailure(returned: unknown): { message: string } | null {
	if (typeof returned !== "object" || returned === null) return null;
	const candidate = returned as { ok?: unknown; error?: { message?: unknown } };
	if (candidate.ok !== false) return null;
	const message = candidate.error?.message;
	return { message: typeof message === "string" ? message : "The clipboard refused the text." };
}

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick" | "onCopy"> {
	/** The exact text written to the clipboard. */
	text: string;
	onCopy: (text: string) => unknown;
	label?: string;
	copiedLabel?: string;
	/** How long "Copied" stays, in milliseconds. */
	copiedMs?: number;
}

export function CopyButton({
	text,
	onCopy,
	label = "Copy",
	copiedLabel = "Copied",
	copiedMs = 1500,
	variant = "ghost",
	size = "sm",
	...rest
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimer = useCallback(() => {
		if (timer.current !== null) {
			clearTimeout(timer.current);
			timer.current = null;
		}
	}, []);

	useEffect(() => clearTimer, [clearTimer]);

	const handleCopy = async () => {
		clearTimer();
		let failure: { message: string } | null;
		try {
			failure = copyFailure(await onCopy(text));
		} catch (cause) {
			failure = { message: messageOf(cause) };
		}
		if (failure !== null) {
			setCopied(false);
			toastError("Couldn't copy", failure);
			return;
		}
		setCopied(true);
		timer.current = setTimeout(() => setCopied(false), copiedMs);
	};

	return (
		<Button
			variant={variant}
			size={size}
			{...rest}
			onClick={() => {
				void handleCopy();
			}}
		>
			<span aria-live="polite">{copied ? copiedLabel : label}</span>
		</Button>
	);
}
