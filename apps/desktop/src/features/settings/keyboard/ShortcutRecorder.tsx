/**
 * @feature SET-02 Shortcut recorder
 * Owns: the control that captures a key combination when the user presses it.
 * Behaviour: ui-map.md 5.4 (shortcuts use Cmd, Alt, Shift, Ctrl and a key) and 6.
 * Must handle: modifier-only presses (wait for a key), Escape cancelling, Backspace clearing, and
 * a key being recorded by its visible character.
 * Test first: pressing Cmd+Shift+K calls onRecord with the combination "Cmd+Shift+K".
 */
import { useEffect, useRef } from "react";
import { Kbd } from "../../../ui/Kbd.tsx";

export interface ShortcutRecorderProps {
	onRecord: (combination: string) => void;
	onCancel: () => void;
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock"]);
const NAMED_KEYS: Readonly<Record<string, string>> = {
	" ": "Space",
	Plus: "Plus",
	Enter: "Enter",
	Tab: "Tab",
	Delete: "Delete",
	ArrowUp: "ArrowUp",
	ArrowDown: "ArrowDown",
	ArrowLeft: "ArrowLeft",
	ArrowRight: "ArrowRight",
	Home: "Home",
	End: "End",
	PageUp: "PageUp",
	PageDown: "PageDown",
};

function keyName(key: string): string | null {
	if (MODIFIER_KEYS.has(key)) return null;
	if (key === "+") return "Plus";
	const named = NAMED_KEYS[key];
	if (named !== undefined) return named;
	if (key.length === 1) return key.toUpperCase();
	if (/^F([1-9]|1[0-2])$/.test(key)) return key;
	return key;
}

export function ShortcutRecorder({ onRecord, onCancel }: ShortcutRecorderProps) {
	const ref = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		ref.current?.focus();
	}, []);

	return (
		<button
			ref={ref}
			type="button"
			aria-label="Recording shortcut"
			className="flex h-8 min-w-40 items-center justify-center rounded-md border border-accent bg-canvas px-3 text-xs text-fg-muted outline-none ring-2 ring-accent/40"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onCancel();
					return;
				}
				if (event.key === "Backspace") {
					event.preventDefault();
					event.stopPropagation();
					onRecord("");
					return;
				}
				const key = keyName(event.key);
				if (key === null) return;
				event.preventDefault();
				event.stopPropagation();
				const parts: string[] = [];
				if (event.metaKey) parts.push("Cmd");
				if (event.ctrlKey) parts.push("Ctrl");
				if (event.altKey) parts.push("Alt");
				if (event.shiftKey) parts.push("Shift");
				parts.push(key);
				onRecord(parts.join("+"));
			}}
			onClick={() => ref.current?.focus()}
		>
			Press a key combination, or <Kbd>Esc</Kbd> to cancel
		</button>
	);
}
