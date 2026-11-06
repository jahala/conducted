/**
 * @feature CHAT-17 Chat search bar
 * Owns: The find bar over the message list: query, match count, next and previous.
 * Behaviour: ui-map.md 3.3 (Search in chat: Cmd+F, next Cmd+G, previous Cmd+Shift+G, 'Scroll to
 * current match' Cmd+Alt+J), 5.1 (chat history search).
 * Must handle: No matches ('0 results'); matches in thinking and tool output (included); the match
 * is in a virtualised-out turn (the list scrolls to that turn's index); Escape closes and returns
 * focus to the composer; the query is kept while switching chats (the chat pane keeps one bar
 * across chats); an answer streaming in while the bar is open never moves the view.
 * Our design choice: matches are counted over the chat view's turns, not DOM text. A turn the list
 * has mounted is found by its `data-turn` attribute and scrolled into view; a turn the list has
 * virtualised out is reached through `onRevealTurn`, which scrolls the list to its index. The view
 * moves only when the user acts (typing, next, previous, Cmd+Alt+J), never when the turns change.
 * Test first: Typing 'foo' with three matches shows '1 of 3' and Cmd+G moves to '2 of 3'.
 */

import type { SessionId, TurnId } from "@conducted/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useChat } from "../../core/hooks.ts";
import type { ChatBlock, ChatTurn } from "../../core/model.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, SearchIcon } from "../../ui/icons.tsx";

export interface ChatSearchBarProps {
	sessionId: SessionId;
	open: boolean;
	onClose: () => void;
	/** Scrolls the message list to the turn at this index, for a turn it has not mounted. */
	onRevealTurn: (index: number) => void;
}

/** One place the query occurs, named by the turn that shows it. */
export interface ChatSearchMatch {
	turnId: TurnId;
	text: string;
	/** Where the match starts in `text`. */
	start: number;
}

function toolText(block: Extract<ChatBlock, { kind: "tool" }>): string {
	const input = JSON.stringify(block.call.item.input ?? null) ?? "null";
	const output = block.call.result?.output ?? "";
	return `${block.call.item.rawName}\n${input}\n${output}`;
}

function segmentsOf(turn: ChatTurn): string[] {
	const segments: string[] = [];
	if (turn.userMessage !== null) segments.push(turn.userMessage.text);
	for (const steer of turn.steers) segments.push(steer.text);
	for (const block of turn.blocks) {
		switch (block.kind) {
			case "text":
			case "thinking":
				segments.push(block.text);
				break;
			case "tool":
				segments.push(toolText(block));
				break;
			case "todo":
				for (const item of block.item.items) segments.push(item.label);
				break;
			case "notice":
				segments.push(block.item.text);
				break;
			case "error":
				segments.push(block.item.message);
				break;
		}
	}
	return segments.filter((segment) => segment.length > 0);
}

/** Every occurrence of `query` in a chat's visible turns, in reading order. */
function findChatMatches(turns: readonly ChatTurn[], query: string): ChatSearchMatch[] {
	const needle = query.toLowerCase();
	if (needle.length === 0) return [];
	const matches: ChatSearchMatch[] = [];
	for (const turn of turns) {
		if (turn.reverted) continue;
		for (const text of segmentsOf(turn)) {
			const haystack = text.toLowerCase();
			let from = 0;
			while (from <= haystack.length) {
				const start = haystack.indexOf(needle, from);
				if (start < 0) break;
				matches.push({ turnId: turn.turnId, text, start });
				from = start + Math.max(1, needle.length);
			}
		}
	}
	return matches;
}

function turnElement(turnId: TurnId): HTMLElement | null {
	for (const element of document.querySelectorAll<HTMLElement>("[data-turn]")) {
		if (element.dataset.turn === turnId) return element;
	}
	return null;
}

export function ChatSearchBar({ sessionId, open, onClose, onRevealTurn }: ChatSearchBarProps) {
	const chat = useChat(sessionId);
	const [query, setQuery] = useState("");
	const [current, setCurrent] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	const turns = chat.state === "ready" ? chat.data.turns : [];
	const matches = useMemo(() => findChatMatches(turns, query), [turns, query]);
	const index = matches.length === 0 ? 0 : Math.min(current, matches.length - 1);

	const close = () => {
		onClose();
		const composer = document.querySelector('[aria-label="composer"]');
		if (composer instanceof HTMLElement) composer.focus();
	};

	/** Brings the turn of one match into view: a mounted turn directly, any other by its index. */
	const reveal = (found: readonly ChatSearchMatch[], at: number) => {
		const match = found[at];
		if (match === undefined) return;
		const element = turnElement(match.turnId);
		if (element !== null) {
			element.scrollIntoView?.({ block: "center" });
			return;
		}
		const turnIndex = turns.findIndex((turn) => turn.turnId === match.turnId);
		if (turnIndex >= 0) onRevealTurn(turnIndex);
	};

	const go = (direction: 1 | -1) => {
		if (matches.length === 0) return;
		const next = (index + direction + matches.length) % matches.length;
		setCurrent(next);
		reveal(matches, next);
	};

	const scrollToMatch = () => reveal(matches, index);

	useEffect(() => {
		if (open) inputRef.current?.focus();
	}, [open]);

	useCommandHandler("chat.findNext", "area", () => {
		if (!open || matches.length === 0) return false;
		go(1);
		return true;
	});
	useCommandHandler("chat.findPrevious", "area", () => {
		if (!open || matches.length === 0) return false;
		go(-1);
		return true;
	});
	useCommandHandler("chat.scrollToMatch", "area", () => {
		if (!open || matches.length === 0) return false;
		scrollToMatch();
		return true;
	});

	if (!open) return null;

	return (
		<search
			aria-label="Find in messages and thinking"
			className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-border-strong bg-raised p-1 shadow-popover"
		>
			<SearchIcon className="ml-1 shrink-0 text-fg-subtle" />
			<input
				ref={inputRef}
				aria-label="Find in messages and thinking"
				value={query}
				onChange={(event) => {
					const next = event.target.value;
					setQuery(next);
					setCurrent(0);
					reveal(findChatMatches(turns, next), 0);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						if (event.shiftKey) go(-1);
						else go(1);
					} else if (event.key === "Escape") {
						event.preventDefault();
						close();
					}
				}}
				placeholder="Find in messages and thinking"
				spellCheck={false}
				className="h-6 w-48 min-w-0 rounded-sm bg-transparent px-1 text-xs text-fg outline-none placeholder:text-fg-subtle focus-visible:ring-2 focus-visible:ring-focus"
			/>
			{query.length === 0 ? null : (
				<span aria-live="polite" className="shrink-0 pr-1 text-2xs text-fg-muted">
					{matches.length === 0 ? "0 results" : `${index + 1} of ${matches.length}`}
				</span>
			)}
			<IconButton
				size="xs"
				label="Previous match"
				disabled={matches.length === 0}
				onClick={() => go(-1)}
				icon={<ChevronRightIcon className="-rotate-90" />}
			/>
			<IconButton
				size="xs"
				label="Next match"
				disabled={matches.length === 0}
				onClick={() => go(1)}
				icon={<ChevronDownIcon className="-rotate-90" />}
			/>
			<IconButton size="xs" label="Close find" onClick={close} icon={<CloseIcon />} />
		</search>
	);
}
