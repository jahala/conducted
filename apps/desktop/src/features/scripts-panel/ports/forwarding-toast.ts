/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: the text of the "Forwarding ports" success toast. Conductor shows it after Cmd+Y turns
 * forwarding on, with the local ports and the process behind each as chips.
 * Behaviour: conductor-assets renderApp `kt.success("Forwarding ports", …)` lists up to three
 * forwards as `:<localPort> <process>` and adds "+N more". We show the same words in one line,
 * because our toast description is text.
 * Must handle: a forward the user turned off (not listed); no enabled forward (no toast); a port
 * whose process is unknown (the port still shows).
 * Test first: lists the local ports and their process names.
 */
import type { PortForwardView } from "../../../core/api.ts";

export const FORWARDING_TOAST_TITLE = "Forwarding ports";
/** How many forwards the toast names before it counts the rest, as Conductor's three chips. */
export const FORWARDING_TOAST_LIMIT = 3;

export interface ForwardingToast {
	title: string;
	description: string;
}

/** The toast for a workspace that just turned forwarding on, or null when nothing is on. */
export function forwardingToast(view: PortForwardView): ForwardingToast | null {
	const running = view.forwards.filter((forward) => forward.enabled);
	if (running.length === 0) return null;
	const nameByRemote = new Map(view.detectedPorts.map((entry) => [entry.port, entry.processName]));
	const parts = running.slice(0, FORWARDING_TOAST_LIMIT).map((forward) => {
		const name = nameByRemote.get(forward.remotePort);
		return name === null || name === undefined
			? `:${forward.localPort}`
			: `:${forward.localPort} ${name}`;
	});
	if (running.length > FORWARDING_TOAST_LIMIT) {
		parts.push(`+${running.length - FORWARDING_TOAST_LIMIT} more`);
	}
	return { title: FORWARDING_TOAST_TITLE, description: parts.join(", ") };
}
