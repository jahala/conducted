/**
 * @feature COMP-08 Dictation button
 * Owns: the microphone button that starts and stops on-device dictation, shows its four states and
 * inserts the finished transcript at the caret.
 * Behaviour: ui-map.md 3.5 (waveform while recording, 'Stop recording', 'Transcribing...'; the
 * 'Voice mode' setting), 5.4 (Ctrl+Shift+D), 6 (Voice mode); services-map.md 5B.3.1 (idle,
 * connecting, recording and processing; the newest attempt wins; microphone denied and
 * unavailable errors).
 * Our design choice: on-device only. Conductor can also use Deepgram, which sends audio to a cloud
 * service and is left out.
 * Must handle: Voice mode off (button hidden, shortcut does nothing); no speech support on this
 * Mac (button hidden); microphone denied and unavailable (toast, no transcript); recording when
 * the editor loses focus (keeps recording); a new attempt while an older one is finishing (the
 * older result is dropped); unmount while recording (dictation is cancelled).
 * Test first: starting shows 'Stop recording'; the transcript is inserted at the caret.
 */
import { messageOf } from "@conducted/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { fireAndForget } from "../../core/async/fire-and-forget.ts";
import {
	createLatestWins,
	type LatestTicket,
	type LatestWins,
} from "../../core/async/latest-wins.ts";
import { useServices } from "../../core/context.tsx";
import { useLiveShortcut, useSetting } from "../../core/hooks.ts";
import type { SpeechEvent } from "../../platform/platform.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";

export type DictationState = "idle" | "connecting" | "recording" | "processing";

export interface DictationButtonProps {
	onTranscript: (text: string) => void;
}

const WAVEFORM_BARS = [0.35, 0.6, 1, 0.75, 0.45];

const LABELS: Record<DictationState, string> = {
	idle: "Start dictation",
	connecting: "Connecting...",
	recording: "Stop recording",
	processing: "Transcribing...",
};

function MicrophoneIcon() {
	return (
		<svg
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<rect x="6" y="2.5" width="4" height="7" rx="2" />
			<path d="M4 7.5a4 4 0 0 0 8 0M8 11.5v2" />
		</svg>
	);
}

/** The input level while recording, as short bars that grow with the user's voice. */
function Waveform({ level }: { level: number }) {
	const strength = Math.max(0.12, Math.min(1, Number.isFinite(level) ? level : 0));
	return (
		<span
			data-testid="dictation-waveform"
			aria-hidden="true"
			className="flex h-4 items-center gap-[2px] text-danger"
		>
			{WAVEFORM_BARS.map((bar) => (
				<span
					key={bar}
					className="w-[2px] rounded-full bg-current"
					style={{ height: `${Math.max(2, Math.round(bar * strength * 16))}px` }}
				/>
			))}
		</span>
	);
}

function joinTranscript(first: string, second: string): string {
	if (first.length === 0) return second;
	if (second.length === 0) return first;
	return `${first} ${second}`;
}

export function DictationButton({ onTranscript }: DictationButtonProps) {
	const { platform } = useServices();
	const speech = platform.speech;
	const enabled = useSetting<boolean>("voice_mode");
	const shortcut = useLiveShortcut("chat.toggleDictation");
	const [available, setAvailable] = useState<boolean | null>(null);
	const [state, setState] = useState<DictationState>("idle");
	const [level, setLevel] = useState(0);
	const stateRef = useRef<DictationState>("idle");
	stateRef.current = state;
	const latest = useRef<LatestWins<"dictation"> | null>(null);
	if (latest.current === null) latest.current = createLatestWins<"dictation">();
	const finalText = useRef("");
	const partialText = useRef("");
	const failed = useRef(false);
	const currentTicket = useRef<LatestTicket<"dictation"> | null>(null);

	useEffect(() => {
		if (!enabled) {
			setAvailable(null);
			if (stateRef.current !== "idle") {
				latest.current?.invalidate("dictation");
				currentTicket.current = null;
				setState("idle");
				setLevel(0);
				fireAndForget(
					() => speech.cancel(),
					(cause) => {
						toastError("Couldn't stop dictation", { message: messageOf(cause) });
					},
				);
			}
			return;
		}
		let live = true;
		fireAndForget(
			() =>
				speech.available().then((answer) => {
					if (live) setAvailable(answer);
				}),
			(cause) => {
				if (!live) return;
				setAvailable(false);
				toastError("Couldn't check whether dictation is available", {
					message: messageOf(cause),
				});
			},
		);
		return () => {
			live = false;
		};
	}, [enabled, speech]);

	const start = useCallback(async () => {
		const wins = latest.current;
		if (wins === null) return;
		const ticket = wins.begin("dictation");
		currentTicket.current = ticket;
		finalText.current = "";
		partialText.current = "";
		failed.current = false;
		setLevel(0);
		setState("connecting");

		const onEvent = (event: SpeechEvent): void => {
			if (!wins.isLatest(ticket)) return;
			switch (event.kind) {
				case "level":
					setLevel(event.value);
					return;
				case "partial":
					partialText.current = event.text;
					return;
				case "final":
					finalText.current = joinTranscript(finalText.current, event.text);
					partialText.current = "";
					return;
				case "error":
					failed.current = true;
					if (event.code === "unavailable") setAvailable(false);
					toast.error(event.message);
					return;
				case "ended": {
					wins.settle(ticket);
					currentTicket.current = null;
					const text = joinTranscript(finalText.current, partialText.current);
					const hadFailed = failed.current;
					setLevel(0);
					setState("idle");
					if (hadFailed) return;
					if (text.trim().length > 0) onTranscript(text);
					else toast.error("Recording ended without a transcript. Try again.");
					return;
				}
			}
		};

		let result: Awaited<ReturnType<typeof speech.start>>;
		try {
			result = await speech.start(onEvent);
		} catch (cause) {
			if (!wins.isLatest(ticket)) return;
			wins.settle(ticket);
			currentTicket.current = null;
			setState("idle");
			setLevel(0);
			toastError("Couldn't start dictation", { message: messageOf(cause) });
			return;
		}
		if (!wins.isLatest(ticket)) {
			// A cancel or a newer attempt won while this one was starting. Release the microphone if
			// nothing newer is running.
			if (currentTicket.current === null) {
				fireAndForget(
					() => speech.cancel(),
					(cause) => {
						toastError("Couldn't stop dictation", { message: messageOf(cause) });
					},
				);
			}
			return;
		}
		if (!result.ok) {
			wins.settle(ticket);
			currentTicket.current = null;
			setState("idle");
			setLevel(0);
			toastError("Couldn't start dictation", result.error);
			return;
		}
		setState("recording");
	}, [onTranscript, speech]);

	const stop = useCallback(async () => {
		if (stateRef.current !== "recording") return;
		setState("processing");
		try {
			await speech.stop();
		} catch (cause) {
			latest.current?.invalidate("dictation");
			currentTicket.current = null;
			setState("idle");
			setLevel(0);
			toastError("Couldn't stop dictation", { message: messageOf(cause) });
		}
	}, [speech]);

	const cancel = useCallback(async () => {
		latest.current?.invalidate("dictation");
		currentTicket.current = null;
		setState("idle");
		setLevel(0);
		try {
			await speech.cancel();
		} catch (cause) {
			toastError("Couldn't stop dictation", { message: messageOf(cause) });
		}
	}, [speech]);

	const restart = useCallback(async () => {
		latest.current?.invalidate("dictation");
		currentTicket.current = null;
		setState("connecting");
		setLevel(0);
		try {
			await speech.cancel();
		} catch (cause) {
			setState("idle");
			toastError("Couldn't restart dictation", { message: messageOf(cause) });
			return;
		}
		await start();
	}, [speech, start]);

	const toggle = useCallback(() => {
		switch (stateRef.current) {
			case "recording":
				void stop();
				return;
			case "connecting":
				void cancel();
				return;
			case "processing":
				// A new recording replaces the one still transcribing; its late result is dropped.
				void restart();
				return;
			case "idle":
				void start();
		}
	}, [cancel, restart, start, stop]);

	useCommandHandler("chat.toggleDictation", "area", () => {
		if (!enabled || available !== true) return true;
		toggle();
		return true;
	});

	useEffect(
		() => () => {
			latest.current?.invalidate("dictation");
			const current = stateRef.current;
			if (current === "idle") return;
			fireAndForget(
				() => speech.cancel(),
				(cause) => {
					toastError("Couldn't stop dictation", { message: messageOf(cause) });
				},
			);
		},
		[speech],
	);

	if (!enabled || available !== true) return null;

	const label = LABELS[state];
	const icon =
		state === "recording" ? (
			<Waveform level={level} />
		) : state === "connecting" ? (
			<Spinner label="Connecting" size="sm" />
		) : state === "processing" ? (
			<Spinner label="Transcribing" size="sm" />
		) : (
			<MicrophoneIcon />
		);

	return (
		<IconButton
			size="xs"
			label={label}
			shortcut={shortcut ?? undefined}
			pressed={state === "recording"}
			icon={icon}
			onClick={toggle}
			data-testid="dictation-button"
		/>
	);
}
