/**
 * @feature CHAT-06 Empty chat
 * Owns: What a chat with no messages shows: a short invitation and four starter prompts.
 * Behaviour: ui-map.md 3.3 (Empty chat starters), 7.2 ('No messages yet').
 * Our design choice: The starter prompts are our own wording (for example: summarise recent
 * changes, tidy the agent instructions, fix a known bug, read the docs). Picking one puts the text
 * into the composer without sending it.
 * Must handle: Archived workspace (no starters, the composer bar explains); the user already typed
 * a draft (a starter replaces nothing without asking, it appends); keyboard reachable.
 * Test first: Clicking a starter calls onPick with its text.
 */

const STARTERS = [
	"Review recent PRs",
	"Improve agent instructions",
	"Fix a known bug",
	"Read the docs",
] as const;

export interface EmptyChatProps {
	onPick: (prompt: string) => void;
	/** An archived workspace is read-only, so there is nothing to start. */
	archived?: boolean;
}

export function EmptyChat({ onPick, archived = false }: EmptyChatProps) {
	return (
		<div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
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
	);
}
