/**
 * @feature CHAT-06 Report a failed action
 * Owns: showing one toast when an action the chat started comes back with an error.
 * Behaviour: not applicable, our own helper. It wraps `toastError` (ui/Toast.tsx) so a handler that cannot await
 * still tells the user when a copy, a retry or a reset failed.
 * Must handle: a successful result (no toast); a failed result (a toast with the given title and the error's message).
 * Test first: a failed result shows its title and message; a successful one shows nothing.
 */
import type { Result } from "@conducted/shared";
import { toastError } from "../../ui/Toast.tsx";

/** Waits for an action and shows a toast named `title` when it failed. */
export async function reportFailure(run: Promise<Result<unknown>>, title: string): Promise<void> {
	const result = await run;
	if (!result.ok) toastError(title, result.error);
}
