/**
 * @feature CHAT-11 Permission grant card
 * Owns: The card for Codex asking for more access (file system, network or command) than its
 * sandbox allows.
 * Behaviour: other-runners.md 4 (Codex permission grants), ui-map.md 3.3 ('Network access' card
 * with Deny and Approve).
 * Our design choice: Approve grants the request for this turn; 'Approve for this session' grants
 * it for the rest of the chat. The card shows the description, the reason, every requested path
 * with its access, and a 'Network access' note when the request asks to reach the network.
 * Must handle: A request that expires (`expiresAt`) shows that it timed out and takes no answer; a
 * double click sends one answer; a failed answer says so and lets the user try again. The caller
 * removes the card when the interaction is withdrawn.
 * Test first: Approve calls sessions.answer with kind permission_grant and granted true.
 */

import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import { CODEX_INTERACTION_TIMEOUT_MS } from "@conducted/protocol";
import type { InteractionId, SessionId } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { useActions } from "../../../core/hooks.ts";
import { Button } from "../../../ui/Button.tsx";
import { withKeys } from "../tools/ToolCardFrame.tsx";

export interface PermissionGrantCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "permission_grant" }>;
	/** When the agent stops waiting, in milliseconds since the epoch. Missing: no limit. */
	expiresAt?: number | null;
	/** The agent already stopped waiting. */
	timedOut?: boolean;
}

type Access = Extract<Interaction, { kind: "permission_grant" }>["paths"][number]["access"];

const ACCESS_LABEL: Record<Access, string> = {
	read: "Read",
	write: "Write",
	deny: "Keep blocked",
};

const TIMEOUT_MINUTES = Math.round(CODEX_INTERACTION_TIMEOUT_MS / 60_000);

export function PermissionGrantCard({
	sessionId,
	interactionId,
	request,
	expiresAt = null,
	timedOut = false,
}: PermissionGrantCardProps) {
	const actions = useActions();
	const [expired, setExpired] = useState(false);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const [chosen, setChosen] = useState<string | null>(null);
	const busy = useRef(false);

	useEffect(() => {
		if (expiresAt === null) return;
		const remaining = expiresAt - Date.now();
		if (remaining <= 0) {
			setExpired(true);
			return;
		}
		const timer = setTimeout(() => setExpired(true), Math.min(remaining, 2_147_483_647));
		return () => clearTimeout(timer);
	}, [expiresAt]);

	const timedOutNow = timedOut || expired;
	const paths = withKeys(
		request.paths,
		(path) => `${path.pathKind}:${path.path}:${path.access}`,
		"path",
	);

	async function send(granted: boolean, grantFor: "turn" | "session"): Promise<void> {
		if (busy.current || chosen !== null || timedOutNow) return;
		busy.current = true;
		setPending(true);
		setFailed(false);
		const answer: Extract<InteractionAnswer, { kind: "permission_grant" }> = granted
			? { kind: "permission_grant", granted: true, grantFor }
			: { kind: "permission_grant", granted: false };
		const result = await actions.sessions.answer(sessionId, interactionId, answer);
		if (!result.ok) {
			busy.current = false;
			setPending(false);
			setFailed(true);
			return;
		}
		setChosen(
			granted
				? grantFor === "session"
					? "Approved for this session"
					: "Approved for this turn"
				: "Denied",
		);
		setPending(false);
	}

	return (
		<fieldset
			aria-label="Permission request"
			className="m-0 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
		>
			<p className="text-sm font-medium text-fg">Codex needs more access</p>
			<p className="text-sm text-fg-muted">{request.description}</p>
			{request.reason === undefined ? null : (
				<p className="text-sm text-fg-muted">{request.reason}</p>
			)}

			{paths.length === 0 ? null : (
				<ul className="flex flex-col gap-1 text-xs text-fg-muted">
					{paths.map(({ key, item }) => (
						<li key={key} className="flex items-center gap-2">
							<span className="w-24 shrink-0 font-medium text-fg">{ACCESS_LABEL[item.access]}</span>
							<span className="min-w-0 truncate font-mono">{item.path}</span>
						</li>
					))}
				</ul>
			)}

			{request.network ? (
				<div className="rounded-md border border-warning-border bg-warning-surface px-2 py-1.5">
					<p className="text-sm font-medium text-warning-fg">Network access</p>
					<p className="text-xs text-warning-fg">This request also asks to reach the network.</p>
				</div>
			) : null}

			{failed ? (
				<p role="alert" className="text-xs text-danger">
					Could not send the answer. Try again.
				</p>
			) : null}

			{timedOutNow ? (
				<p role="status" className="text-sm text-fg-muted">
					This request timed out after {TIMEOUT_MINUTES} minutes. The agent stopped waiting.
				</p>
			) : chosen !== null ? (
				<p role="status" className="text-sm font-medium text-fg">
					{chosen}
				</p>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<Button onClick={() => void send(true, "turn")} loading={pending}>
						Approve
					</Button>
					<Button variant="secondary" onClick={() => void send(true, "session")} disabled={pending}>
						Approve for this session
					</Button>
					<Button variant="outline" onClick={() => void send(false, "turn")} disabled={pending}>
						Deny
					</Button>
				</div>
			)}
		</fieldset>
	);
}
