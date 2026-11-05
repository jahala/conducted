/**
 * @feature APP-13 CopyButton
 * Owns: the one copy button used by code blocks, diagnostics, paths and logs, with its short confirmation.
 * Behaviour: ui-map.md 8 (SimpleCopyButton); ui-map.md 3.3 (code blocks copy), 2 (diagnostics copy).
 * Our design choice: the caller supplies the copy action, so the kit never reaches the Platform itself. The
 * label changes from "Copy" to "Copied" for a moment (1.5s by default) and back. A copy that fails leaves
 * the label alone: a screen never claims something the clipboard did not take.
 * Must handle: an asynchronous copy; a second copy inside the confirmation window (it restarts the timer);
 * unmounting while the timer runs (it is cleared); a caller that styles the button or gives it a name.
 * Test first: clicking calls onCopy with the button's text, shows "Copied", then returns to "Copy".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "./Button.tsx";

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
		try {
			await onCopy(text);
		} catch {
			setCopied(false);
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
