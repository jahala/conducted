/**
 * @feature CHAT-09 Todo block
 * Owns: A todo list the agent emitted as its own block in the turn.
 * Behaviour: ui-map.md 3.3 (Todo), frontend.md 5 (todo lists use the 'todo' kind).
 * Must handle: A later todo block in the same turn replaces the earlier one in view (only the
 * newest is expanded); no items; the block names how many are done.
 * Test first: A block with 3 items and 1 done reads '1 of 3 done' and lists the three items.
 */

import type { AgentItem } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

export interface TodoBlockProps {
	item: Extract<AgentItem, { kind: "todo" }>;
}

export function TodoBlock(_props: TodoBlockProps): never {
	return notImplemented("CHAT-09");
}
