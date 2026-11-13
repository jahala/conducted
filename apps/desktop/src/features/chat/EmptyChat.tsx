/**
 * @feature CHAT-06 Empty chat
 * Owns: What a chat with no messages shows: a short invitation and four starter prompts.
 * Behaviour: ui-map.md 3.3 (Empty chat starters), 7.2 ('No messages yet'). The starters are
 * Conductor's own four (renderApp @9380506), the third naming a one-line commented task. Picking one
 * puts the text into the composer without sending it.
 * Must handle: Archived workspace (no starters, the composer bar explains); the user already typed
 * a draft (a starter replaces nothing without asking, it appends); keyboard reachable.
 * Test first: Clicking a starter calls onPick with its text.
 * Above it all, a new local workspace's setup timeline (SetupTimeline, WS-03) until a chat of the
 * workspace has a message.
 * Given its chat and workspace, it also shows the context shelves above the starters (CHAT-26,
 * ChatContextShelves). Conductor shows the shelves instead of its starters when the workspace has
 * other chats; we keep our starters too, so nothing the user had is taken away.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { ChatContextShelves } from "./ChatContextShelves.tsx";
import { SetupTimeline } from "./SetupTimeline.tsx";

const STARTERS = [
	"Review recent PRs",
	"Improve agent instructions",
	"Fix a TODO",
	"Read the docs",
] as const;

export interface EmptyChatProps {
	onPick: (prompt: string) => void;
	/** An archived workspace is read-only, so there is nothing to start. */
	archived?: boolean;
	/** This chat, for the context shelves (CHAT-26). Without it the shelves are left out. */
	sessionId?: SessionId;
	workspaceId?: WorkspaceId;
	/** The workspace's folder name, for "New chat in /<name>." */
	directory?: string;
}

export function EmptyChat({
	onPick,
	archived = false,
	sessionId,
	workspaceId,
	directory,
}: EmptyChatProps) {
	return (
		<div className="flex h-full w-full flex-col">
			{archived || workspaceId === undefined ? null : <SetupTimeline workspaceId={workspaceId} />}
			<div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
				{archived ||
				sessionId === undefined ||
				workspaceId === undefined ||
				directory === undefined ? null : (
					<div className="w-full max-w-lg">
						<ChatContextShelves
							sessionId={sessionId}
							workspaceId={workspaceId}
							directory={directory}
						/>
					</div>
				)}
				<div className="flex flex-col gap-1">
					<h2 className="text-sm text-fg-muted">No messages yet</h2>
					<p className="max-w-prose text-sm text-fg-muted">
						Ask the agent to change something, or start with one of these.
					</p>
				</div>
				{archived ? null : (
					<div className="grid w-full max-w-lg grid-cols-2 gap-2">
						{STARTERS.map((prompt) => (
							<button
								key={prompt}
								type="button"
								onClick={() => onPick(prompt)}
								className="rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm font-book text-fg hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
							>
								{prompt}
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
