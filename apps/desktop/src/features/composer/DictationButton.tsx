/**
 * @feature COMP-08 Dictation button
 * Owns: The microphone button: start and stop on-device dictation and insert the text.
 * Behaviour: ui-map.md 3.5 (speech to text button: waveform while recording, 'Stop recording',
 * 'Transcribing...'; Ctrl+Shift+D; setting 'Voice mode'; uses on-device speech).
 * Our design choice: On-device only. Conductor can also use Deepgram, which sends audio to a cloud
 * service and is left out.
 * Must handle: No microphone permission (explain how to allow it); no speech support on this Mac
 * (button hidden); recording while the editor loses focus (keeps recording); transcribing (spinner
 * and label); the result is inserted at the caret, not appended to the end.
 * Test first: Starting shows 'Stop recording'; the transcript is inserted at the caret.
 */
import { notImplemented } from "@conducted/shared";

export interface DictationButtonProps {
	onTranscript: (text: string) => void;
}

export function DictationButton(_props: DictationButtonProps): never {
	return notImplemented("COMP-08");
}
