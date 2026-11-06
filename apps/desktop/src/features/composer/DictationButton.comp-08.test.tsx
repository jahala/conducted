/**
 * @feature COMP-08 Dictation button
 * Owns: tests for the microphone button's four states, the Voice mode gate, the dictation errors,
 * the Ctrl+Shift+D shortcut and the transcript landing at the caret.
 * Behaviour: ui-map.md 3.5 (speech to text: waveform, 'Stop recording', 'Transcribing...'),
 * 5.4 (Ctrl+Shift+D), 6 (Voice mode); services-map.md 5B.3.1 (idle, connecting, recording,
 * processing; the newest attempt wins; microphone denied and unavailable errors).
 * Test first: starting shows 'Stop recording'; the transcript is inserted at the caret.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok, type Result, type SessionId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { SpeechEvent } from "../../platform/platform.ts";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { Composer } from "./Composer.tsx";
import { DictationButton } from "./DictationButton.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	test?.close();
	test = undefined;
});

const openChat = (container: Container, sessionId: SessionId): void => {
	act(() => {
		container.services.sessions.store.setState({ viewingSessionId: sessionId });
	});
};

const enableVoiceMode = (container: Container, enabled = true): void => {
	act(() => {
		container.services.settings.store.setState((state) => ({
			values: { ...state.values, voice_mode: enabled },
		}));
	});
};

interface ScriptedSpeech {
	listeners: ((event: SpeechEvent) => void)[];
	start: ReturnType<typeof vi.spyOn>;
	stop: ReturnType<typeof vi.spyOn>;
	cancel: ReturnType<typeof vi.spyOn>;
	emit(index: number, event: SpeechEvent): void;
}

const scriptSpeech = (container: Container): ScriptedSpeech => {
	const listeners: ((event: SpeechEvent) => void)[] = [];
	const start = vi
		.spyOn(container.platform.speech, "start")
		.mockImplementation(async (listener) => {
			listeners.push(listener);
			return ok(undefined);
		});
	const stop = vi.spyOn(container.platform.speech, "stop").mockImplementation(async () => {});
	const cancel = vi.spyOn(container.platform.speech, "cancel").mockImplementation(async () => {});
	return {
		listeners,
		start,
		stop,
		cancel,
		emit(index, event) {
			act(() => listeners[index]?.(event));
		},
	};
};

const renderDictation = (container: Container, onTranscript: (text: string) => void) =>
	render(
		<ServicesProvider container={container}>
			<CommandDispatcher>
				<DictationButton onTranscript={onTranscript} />
				<textarea aria-label="message" />
			</CommandDispatcher>
			<Toaster />
		</ServicesProvider>,
	);

const pressDictationShortcut = (field: HTMLElement): void => {
	field.focus();
	fireEvent.keyDown(field, {
		key: "d",
		ctrlKey: true,
		shiftKey: true,
		bubbles: true,
		cancelable: true,
	});
};

const deferred = (): {
	promise: Promise<Result<void>>;
	resolve: (value: Result<void>) => void;
} => {
	let resolve!: (value: Result<void>) => void;
	const promise = new Promise<Result<void>>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

const composerEditor = (): HTMLElement => screen.getByLabelText("composer");

describe("COMP-08 DictationButton", () => {
	it("COMP-08 starts on click and inserts the finished transcript", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const speech = scriptSpeech(test.container);
		const onTranscript = vi.fn();
		renderDictation(test.container, onTranscript);

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));
		expect(await screen.findByRole("button", { name: "Stop recording" })).toBeTruthy();
		expect(screen.getByTestId("dictation-waveform")).toBeTruthy();
		expect(speech.start).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
		expect(await screen.findByRole("button", { name: "Transcribing..." })).toBeTruthy();

		speech.emit(0, { kind: "final", text: "hello" });
		speech.emit(0, { kind: "ended" });

		await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("hello"));
		expect(await screen.findByRole("button", { name: "Start dictation" })).toBeTruthy();
	});

	it("COMP-08 shows connecting until the recognizer starts", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const pending = deferred();
		vi.spyOn(test.container.platform.speech, "start").mockReturnValue(pending.promise);
		renderDictation(test.container, vi.fn());

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));
		expect(await screen.findByRole("button", { name: "Connecting..." })).toBeTruthy();

		act(() => pending.resolve(ok(undefined)));
		expect(await screen.findByRole("button", { name: "Stop recording" })).toBeTruthy();
	});

	it("COMP-08 keeps recording when the chat input loses focus", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		scriptSpeech(test.container);
		renderDictation(test.container, vi.fn());

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));
		await screen.findByRole("button", { name: "Stop recording" });
		fireEvent.blur(screen.getByLabelText("message"));

		expect(screen.getByRole("button", { name: "Stop recording" })).toBeTruthy();
	});

	it("COMP-08 lets only the newest attempt change the transcript", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const speech = scriptSpeech(test.container);
		const onTranscript = vi.fn();
		renderDictation(test.container, onTranscript);

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));
		fireEvent.click(await screen.findByRole("button", { name: "Stop recording" }));
		fireEvent.click(await screen.findByRole("button", { name: "Transcribing..." }));

		await waitFor(() => expect(speech.listeners).toHaveLength(2));
		expect(await screen.findByRole("button", { name: "Stop recording" })).toBeTruthy();

		speech.emit(0, { kind: "final", text: "old" });
		speech.emit(0, { kind: "ended" });
		expect(onTranscript).not.toHaveBeenCalled();

		speech.emit(1, { kind: "final", text: "new" });
		speech.emit(1, { kind: "ended" });
		await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("new"));
		expect(onTranscript).toHaveBeenCalledTimes(1);
	});

	it("COMP-08 shows the microphone denial and keeps the transcript empty", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const speech = scriptSpeech(test.container);
		const onTranscript = vi.fn();
		renderDictation(test.container, onTranscript);

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));
		await screen.findByRole("button", { name: "Stop recording" });

		speech.emit(0, {
			kind: "error",
			code: "microphone_denied",
			message: "Microphone access denied.",
		});
		speech.emit(0, { kind: "ended" });

		expect(await screen.findByText("Microphone access denied.")).toBeTruthy();
		expect(onTranscript).not.toHaveBeenCalled();
		expect(await screen.findByRole("button", { name: "Start dictation" })).toBeTruthy();
	});

	it("COMP-08 reports speech that becomes unavailable and hides the button", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const speech = scriptSpeech(test.container);
		const onTranscript = vi.fn();
		renderDictation(test.container, onTranscript);

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));
		await screen.findByRole("button", { name: "Stop recording" });

		speech.emit(0, {
			kind: "error",
			code: "unavailable",
			message: "Failed to initialize speech-to-text.",
		});
		speech.emit(0, { kind: "ended" });

		expect(await screen.findByText("Failed to initialize speech-to-text.")).toBeTruthy();
		expect(onTranscript).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "Start dictation" })).toBeNull();
	});

	it("COMP-08 stays hidden while Voice mode is off", () => {
		test = createTestContainer();
		renderDictation(test.container, vi.fn());
		expect(screen.queryByRole("button", { name: "Start dictation" })).toBeNull();
	});

	it("COMP-08 stays hidden when this Mac cannot recognise speech", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const available = vi
			.spyOn(test.container.platform.speech, "available")
			.mockResolvedValue(false);
		renderDictation(test.container, vi.fn());

		await waitFor(() => expect(available).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Start dictation" })).toBeNull();
	});

	it("COMP-08 starts and stops from Ctrl+Shift+D in the chat input", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		openChat(test.container, "chat-1" as SessionId);
		const speech = scriptSpeech(test.container);
		const onTranscript = vi.fn();
		renderDictation(test.container, onTranscript);
		await screen.findByRole("button", { name: "Start dictation" });

		pressDictationShortcut(screen.getByLabelText("message"));
		expect(await screen.findByRole("button", { name: "Stop recording" })).toBeTruthy();
		expect(speech.start).toHaveBeenCalledTimes(1);

		pressDictationShortcut(screen.getByLabelText("message"));
		expect(await screen.findByRole("button", { name: "Transcribing..." })).toBeTruthy();
		speech.emit(0, { kind: "final", text: "from the shortcut" });
		speech.emit(0, { kind: "ended" });
		await waitFor(() => expect(onTranscript).toHaveBeenCalledWith("from the shortcut"));
	});

	it("COMP-08 ignores Ctrl+Shift+D while Voice mode is off", async () => {
		test = createTestContainer();
		openChat(test.container, "chat-1" as SessionId);
		const speech = scriptSpeech(test.container);
		renderDictation(test.container, vi.fn());

		pressDictationShortcut(screen.getByLabelText("message"));
		await act(async () => {
			await Promise.resolve();
		});
		expect(speech.start).not.toHaveBeenCalled();
	});

	it("COMP-08 cancels dictation when the button goes away", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const speech = scriptSpeech(test.container);
		const view = renderDictation(test.container, vi.fn());

		fireEvent.click(await screen.findByRole("button", { name: "Start dictation" }));
		await screen.findByRole("button", { name: "Stop recording" });
		view.unmount();

		await waitFor(() => expect(speech.cancel).toHaveBeenCalledTimes(1));
	});

	it("COMP-08 inserts the transcript at the caret in the composer", async () => {
		test = createTestContainer();
		enableVoiceMode(test.container);
		const speech = scriptSpeech(test.container);
		const workspace = await seedWorkspace(test.container);
		const created = await test.container.services.sessions.create(workspace.id, CONFIG);
		if (!created.ok) throw new Error(created.error.message);
		openChat(test.container, created.value.id);
		const editors: Editor[] = [];
		render(
			<ServicesProvider container={test.container}>
				<CommandDispatcher>
					<Composer
						workspaceId={workspace.id}
						sessionId={created.value.id}
						onEditorReady={(ready: Editor | null) => {
							if (ready !== null) editors.push(ready);
						}}
					/>
				</CommandDispatcher>
			</ServicesProvider>,
		);
		await screen.findByRole("button", { name: "Start dictation" });
		await waitFor(() => expect(editors).toHaveLength(1));
		const ready = editors[0];
		if (ready === undefined) throw new Error("the composer never handed over its editor");
		act(() => {
			ready.commands.setContent("Hello world");
			ready.commands.setTextSelection(7);
			ready.commands.focus();
		});

		fireEvent.keyDown(composerEditor(), {
			key: "d",
			ctrlKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		await screen.findByRole("button", { name: "Stop recording" });
		fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
		speech.emit(0, { kind: "final", text: "big " });
		speech.emit(0, { kind: "ended" });

		await waitFor(() => expect(ready.getText()).toBe("Hello big world"));
	});
});
