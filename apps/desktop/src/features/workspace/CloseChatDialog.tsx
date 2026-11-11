/**
 * @feature NAV-10 Close a running chat
 * Owns: the confirmation shown before a chat whose agent is working is closed.
 * Behaviour: research/conductor/success-side-effects.md row 6, renderApp @11398676: the title is
 * "Close running chats?" when more than one runs and "Close running chat?" otherwise; the body
 * names the running count, a chat waiting on background tasks, or the agent being cancelled;
 * Cancel and the destructive "Close anyway" (Cmd+Enter) are the two actions.
 * Must handle: one chat, several chats, a chat waiting for background tasks, a chat with no agent
 * named, and Escape, Cancel or the overlay closing it without closing anything.
 * Test first: closing a working chat asks first.
 */
import type { Session } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { Kbd } from "../../ui/Kbd.tsx";

export interface CloseChatDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** How many chats will be closed. Above one, Conductor uses the plural words. */
	runningCount: number;
	/** The chat the body names when only one runs. */
	session: Session | null;
	/** True when that chat waits on background tasks, which changes the body. */
	waiting: boolean;
	onConfirm: () => void;
}

/** "Claude", "Codex", "Cursor", "Acp", as Conductor capitalises the agent's name. */
function agentName(session: Session | null): string {
	if (session === null) return "the agent";
	const agent = session.config.agent;
	return `${agent.slice(0, 1).toUpperCase()}${agent.slice(1).toLowerCase()}`;
}

export function closeChatDialogText({
	runningCount,
	session,
	waiting,
}: Pick<CloseChatDialogProps, "runningCount" | "session" | "waiting">): {
	title: string;
	description: string;
} {
	if (runningCount > 1) {
		return {
			title: "Close running chats?",
			description: `${runningCount} chats are currently running. Closing them will stop their agents.`,
		};
	}
	return {
		title: "Close running chat?",
		description: waiting
			? "This chat is waiting for background tasks. Closing it will stop them."
			: `This chat is currently running. Closing it will cancel ${agentName(session)}.`,
	};
}

export function CloseChatDialog({
	open,
	onOpenChange,
	runningCount,
	session,
	waiting,
	onConfirm,
}: CloseChatDialogProps) {
	const { title, description } = closeChatDialogText({ runningCount, session, waiting });
	const confirm = () => {
		onOpenChange(false);
		onConfirm();
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={title} description={description} onConfirm={confirm}>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={confirm}>
						Close anyway
						<span className="ml-2 inline-flex items-center opacity-60">
							⌘<Kbd aria-label="Command and Enter">↵</Kbd>
						</span>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
