/**
 * @feature COMP-04 @ file mentions
 * @feature COMP-05 # PR and issue mentions
 * @feature COMP-09 § snippets
 * Owns: ending a composer test only after its trigger popups have torn down.
 * Behaviour: test support only.
 * Must handle: an editor TipTap destroys on its next tick after the composer unmounts; an editor
 * the test already destroyed; an editor that never had a trigger popup open.
 * Test first: not applicable.
 *
 * TipTap destroys the editor from a timer once its component unmounts, and a trigger popup
 * unmounts its detached React root in a microtask after that. Left to run after the test file,
 * that work reaches React's scheduler once jsdom's window is gone ("window is not defined"). The
 * destroy event is the product's own end of that work; waiting for it inside act keeps the popup's
 * unmount in the act queue, which act flushes before the environment is torn down.
 */

import { act, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

/**
 * Waits, inside act, for `editor` to be destroyed and for the trigger popups' root unmounts that
 * follow it. Await it after the test has already destroyed the editor, or with an editor the
 * composer still owns; `unmountComposer` calls it after taking the composer off the page.
 */
export async function settleEditorTeardown(editor: Editor | null): Promise<void> {
	const destroyed = new Promise<void>((resolve) => {
		if (editor === null || editor.isDestroyed) {
			resolve();
			return;
		}
		editor.on("destroy", () => resolve());
	});
	await act(async () => {
		await destroyed;
	});
}

/** Unmounts the rendered composer and waits for its editor and trigger popups to come down. */
export async function unmountComposer(editor: Editor | null): Promise<void> {
	cleanup();
	await settleEditorTeardown(editor);
}
