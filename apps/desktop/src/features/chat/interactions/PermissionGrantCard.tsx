/**
 * @feature CHAT-11 Permission grant card
 * Owns: The card for Codex asking for more access (file system or network) than its sandbox
 * allows.
 * Behaviour: other-runners.md 4 (Codex permission grants), ui-map.md 3.3 ('Network access' card
 * with Deny and Approve).
 * Our design choice: Approve grants the request for this turn; 'Approve for this session' grants
 * it for the rest of the chat. The card shows the description, the reason, every requested path
 * with its access, and a 'Network access' card with Deny and Approve when the request asks to
 * reach the network.
 * Must handle: A request that expires (`expiresAt`) shows that it timed out and takes no answer; a
 * double click sends one answer; a failed answer shows the error and lets the user try again. The
 * caller removes the card when the interaction is withdrawn.
 * Test first: Approve calls sessions.answer with kind permission_grant and granted true.
 */

import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import type { Clock, InteractionId, SessionId } from "@conducted/shared";
import { Button } from "../../../ui/Button.tsx";
import { withKeys } from "../tools/ToolCardFrame.tsx";
import { TIMED_OUT_TEXT, useExpiry } from "./use-expiry.ts";
import { useInteractionAnswer } from "./use-interaction-answer.ts";

export interface PermissionGrantCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "permission_grant" }>;
	/** When the agent stops waiting, in milliseconds since the epoch. Missing: no limit. */
	expiresAt?: number | null;
	/** The agent already stopped waiting. */
	timedOut?: boolean;
	/** The clock the expiry timer reads. Tests pass a fake one. */
	clock?: Clock;
}

type Access = Extract<Interaction, { kind: "permission_grant" }>["paths"][number]["access"];

const ACCESS_LABEL: Record<Access, string> = {
	read: "Read",
	write: "Write",
	deny: "Keep blocked",
};

export function PermissionGrantCard({
	sessionId,
	interactionId,
	request,
	expiresAt = null,
	timedOut = false,
	clock,
}: PermissionGrantCardProps) {
	const expired = useExpiry(expiresAt, clock);
	const timedOutNow = timedOut || expired;
	const answerState = useInteractionAnswer<
		Extract<InteractionAnswer, { kind: "permission_grant" }>
	>({
		sessionId,
		interactionId,
		blocked: timedOutNow,
		labelFor: (answer) =>
			answer.granted
				? answer.grantFor === "session"
					? "Approved for this session"
					: "Approved for this turn"
				: "Denied",
	});
	const pending = answerState.pending !== null;
	const paths = withKeys(
		request.paths,
		(path) => `${path.pathKind}:${path.path}:${path.access}`,
		"path",
	);

	function send(granted: boolean, grantFor: "turn" | "session"): void {
		void answerState.answer(
			granted
				? { kind: "permission_grant", granted: true, grantFor }
				: { kind: "permission_grant", granted: false },
		);
	}

	const turnButtons = (
		<>
			<Button
				onClick={() => send(true, "turn")}
				loading={
					answerState.pending?.granted === true && answerState.pending.grantFor !== "session"
				}
				disabled={pending}
			>
				Approve
			</Button>
			<Button
				variant="outline"
				onClick={() => send(false, "turn")}
				loading={answerState.pending?.granted === false}
				disabled={pending}
			>
				Deny
			</Button>
		</>
	);
	const sessionButton = (
		<Button
			variant="secondary"
			onClick={() => send(true, "session")}
			loading={answerState.pending?.grantFor === "session"}
			disabled={pending}
		>
			Approve for this session
		</Button>
	);

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

			{answerState.failed === null ? null : (
				<p role="alert" className="text-xs text-danger">
					Could not send the answer: {answerState.failed}
				</p>
			)}

			{timedOutNow ? (
				<p role="status" className="text-sm text-fg-muted">
					{TIMED_OUT_TEXT}
				</p>
			) : answerState.chosen !== null ? (
				<p role="status" className="text-sm font-medium text-fg">
					{answerState.chosen}
				</p>
			) : (
				<div className="flex flex-col gap-2">
					{request.network ? (
						<section
							aria-label="Network access"
							className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-surface p-2"
						>
							<div className="flex flex-col gap-1">
								<p className="text-sm font-medium text-warning-fg">Network access</p>
								<p className="text-xs text-warning-fg">
									This request also asks to reach the network.
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">{turnButtons}</div>
						</section>
					) : (
						<div className="flex flex-wrap items-center gap-2">{turnButtons}</div>
					)}
					{sessionButton}
				</div>
			)}
		</fieldset>
	);
}
