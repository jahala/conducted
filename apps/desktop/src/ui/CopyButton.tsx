/**
 * @feature APP-13 CopyButton
 * Owns: the one copy button used by code blocks, diagnostics, paths and logs, with its short confirmation.
 * Behaviour: ui-map.md 8 (SimpleCopyButton); ui-map.md 3.3 (code blocks copy), 2 (diagnostics copy).
 * Our design choice: the caller supplies the copy action, so the kit never reaches the Platform itself. The
 * label changes from "Copy" to "Copied" for a moment (1.5s by default) and back. A copy that fails, by throwing
 * or by returning a failed `Result`, leaves the label alone and shows Conductor's error toast, "Failed to
 * copy" with "Please try again." (renderApp @1717306), or the caller's own words, such as the plan bar's
 * "Failed to copy plan" (@9312315): a screen never claims something the clipboard did not take, and the
 * user is told it did not.
 * Must handle: an asynchronous copy; a second copy inside the confirmation window (it restarts the timer);
 * unmounting while the timer runs (it is cleared); a caller that styles the button or gives it a name.
 * Test first: clicking calls onCopy with the button's text, shows "Copied", then returns to "Copy".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, type ButtonProps } from "./Button.tsx";
import { CheckIcon, CopyIcon } from "./icons.tsx";
import { toast } from "./Toast.tsx";

/** True when the copy action returned a failed `Result`; it may return nothing. */
function copyFailed(returned: unknown): boolean {
	if (typeof returned !== "object" || returned === null) return false;
	return (returned as { ok?: unknown }).ok === false;
}

export interface CopyButtonProps extends Omit<ButtonProps, "children" | "onClick" | "onCopy"> {
	/** The exact text written to the clipboard. */
	text: string;
	onCopy: (text: string) => unknown;
	label?: string;
	copiedLabel?: string;
	/** How long "Copied" stays, in milliseconds. */
	copiedMs?: number;
	/** Shows a copy icon (a check once copied) instead of the words; the words become its name. */
	iconOnly?: boolean;
	/** The toast when the copy fails, for a copy Conductor names (the plan bar's "Failed to copy plan"). */
	failureTitle?: string;
}

export function CopyButton({
	text,
	onCopy,
	label = "Copy",
	copiedLabel = "Copied",
	copiedMs = 1500,
	iconOnly = false,
	failureTitle,
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
		let failed: boolean;
		try {
			failed = copyFailed(await onCopy(text));
		} catch {
			failed = true;
		}
		if (failed) {
			setCopied(false);
			if (failureTitle === undefined)
				toast.error("Failed to copy", { description: "Please try again." });
			else toast.error(failureTitle);
			return;
		}
		setCopied(true);
		timer.current = setTimeout(() => setCopied(false), copiedMs);
	};

	return (
		<Button
			variant={variant}
			size={size}
			{...(iconOnly ? { "aria-label": copied ? copiedLabel : label, title: label } : {})}
			{...rest}
			onClick={() => {
				void handleCopy();
			}}
		>
			{iconOnly ? (
				copied ? (
					<CheckIcon className="size-3.5" />
				) : (
					<CopyIcon className="size-3.5" />
				)
			) : (
				<span aria-live="polite">{copied ? copiedLabel : label}</span>
			)}
		</Button>
	);
}
