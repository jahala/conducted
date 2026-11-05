/**
 * @feature COMP-04 @ file mentions
 * Owns: The '@' trigger: fuzzy search of files and directories in the workspace, the extra items
 * for plans, the current terminal output and the working-directories dialog, and the chip the
 * trigger inserts.
 * Behaviour: ui-map.md 3.5 ('@' mentions: files and directories with fuzzy search, plans,
 * 'Attach current terminal output', linked directories 'Select working directories'), sessions-and-
 * chats.md (the sidecar expands file mentions).
 * Data: `search` is passed in and reads the workspace file list; `actions` are the extra rows the
 * composer supplies. The chip stores the relative path, and the sidecar expands it.
 * Our design choice: the trigger is one ProseMirror plugin rather than TipTap's suggestion helper,
 * because the editor already carries no extra TipTap packages. The plugin holds the query, the
 * ranked rows and the selected row, and draws them with SuggestionPopup.
 * Must handle: no matches ('No files found'); at most 20 file rows; Escape closes the popup and
 * keeps the typed '@'; Arrow keys wrap; Enter and Tab choose; a trigger inside a word does not
 * open; a chosen action runs instead of inserting a chip.
 * Test first: Typing '@rea' offers 'README.md' first; choosing it inserts a chip with the path.
 */
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Node } from "@tiptap/react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { rankFuzzy } from "../../../core/fuzzy.ts";
import { SuggestionPopup, type SuggestionRow } from "./SuggestionPopup.tsx";

export interface FileMentionItem {
	path: string;
	isDirectory: boolean;
}

/** An extra row the '@' trigger offers beside files. */
export interface FileMentionAction {
	id: string;
	label: string;
	detail?: string;
	onChoose: () => void;
}

export interface FileMentionDeps {
	search: (query: string) => FileMentionItem[];
	/** Plans, "Attach current terminal output", "Select working directories". */
	actions?: readonly FileMentionAction[];
	/** How many file rows to show. Defaults to 20. */
	limit?: number;
}

export interface FileMentionSuggestion {
	id: string;
	label: string;
	detail?: string;
	path?: string;
	isDirectory?: boolean;
	onChoose?: () => void;
}

export interface FileMentionState {
	active: boolean;
	query: string;
	/** Document position of the typed '@'. */
	from: number;
	/** Document position just after the query. */
	to: number;
	selectedIndex: number;
	items: readonly FileMentionSuggestion[];
}

export const FILE_MENTION_LIMIT = 20;
export const FILE_MENTION_NODE_NAME = "fileMention";
const TRIGGER = /(?:^|[\s([{])@([^\s@]*)$/;

interface MentionMeta {
	type: "select" | "close";
	index?: number;
}

const mentionPluginKey = new PluginKey<FileMentionState>("conductedFileMention");

const inactive: FileMentionState = {
	active: false,
	query: "",
	from: 0,
	to: 0,
	selectedIndex: 0,
	items: [],
};

/** The rows the '@' trigger shows for a query: matching actions, then matching files, by score. */
export function fileMentionSuggestions(
	query: string,
	deps: FileMentionDeps,
): FileMentionSuggestion[] {
	const limit = deps.limit ?? FILE_MENTION_LIMIT;
	const actions = deps.actions ?? [];
	const fileRows = rankFuzzy(
		deps.search(query),
		query,
		[{ text: (item: FileMentionItem) => item.path, weight: 1 }],
		limit,
	).map((ranked) => ({
		score: ranked.score,
		row: {
			id: `file:${ranked.item.path}`,
			label: ranked.item.path,
			detail: ranked.item.isDirectory ? "Directory" : undefined,
			path: ranked.item.path,
			isDirectory: ranked.item.isDirectory,
		} satisfies FileMentionSuggestion,
	}));
	const actionRows = rankFuzzy(
		actions,
		query,
		[{ text: (action: FileMentionAction) => action.label, weight: 1 }],
		limit,
	).map((ranked) => ({
		score: ranked.score,
		row: {
			id: `action:${ranked.item.id}`,
			label: ranked.item.label,
			detail: ranked.item.detail,
			onChoose: ranked.item.onChoose,
		} satisfies FileMentionSuggestion,
	}));
	if (query.trim() === "") {
		return [...actionRows, ...fileRows].slice(0, limit).map((entry) => entry.row);
	}
	return [...actionRows, ...fileRows]
		.sort((left, right) => right.score - left.score)
		.slice(0, limit)
		.map((entry) => entry.row);
}

/** Reads the '@' trigger from the text before the caret. */
function stateAtEditor(state: EditorState, deps: FileMentionDeps): FileMentionState {
	if (!state.selection.empty) return inactive;
	const { $from } = state.selection;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
	const match = TRIGGER.exec(before);
	if (match === null) return inactive;
	const query = match[1] ?? "";
	const from = $from.pos - (query.length + 1);
	const items = fileMentionSuggestions(query, deps);
	return {
		active: true,
		query,
		from,
		to: $from.pos,
		selectedIndex: items.length === 0 ? 0 : Math.min(inactive.selectedIndex, items.length - 1),
		items,
	};
}

/** The '@' state of an editor, for a caller that draws its own popup. Null when the trigger is closed. */
export function fileMentionState(editor: { state: EditorState }): FileMentionState | null {
	const state = mentionPluginKey.getState(editor.state);
	return state === undefined || !state.active ? null : state;
}

function chooseSuggestion(view: EditorView, state: FileMentionState, index: number): boolean {
	const item = state.items[index];
	if (item === undefined) return false;
	const type = view.state.schema.nodes[FILE_MENTION_NODE_NAME];
	if (type === undefined) return false;
	const transaction = view.state.tr;
	if (item.onChoose === undefined) {
		const chip = type.create({ path: item.path ?? "", isDirectory: item.isDirectory ?? false });
		const end = state.from + chip.nodeSize + 1;
		transaction.replaceWith(state.from, state.to, chip);
		transaction.insertText(" ", state.from + chip.nodeSize);
		transaction.setSelection(TextSelection.near(transaction.doc.resolve(end)));
	} else {
		transaction.delete(state.from, state.to);
	}
	view.dispatch(transaction.scrollIntoView());
	item.onChoose?.();
	return true;
}

class MentionPopupView {
	#view: EditorView;
	#host: HTMLDivElement | null = null;
	#root: Root | null = null;
	#signature = "";

	constructor(view: EditorView) {
		this.#view = view;
		this.update(view);
	}

	update(view: EditorView): void {
		this.#view = view;
		const state = mentionPluginKey.getState(view.state);
		if (state === undefined || !state.active || state.items.length === 0) {
			this.#close();
			return;
		}
		const signature = `${state.query}|${state.selectedIndex}|${state.items
			.map((item) => item.id)
			.join(",")}`;
		if (signature === this.#signature) return;
		this.#signature = signature;
		if (this.#host === null) {
			this.#host = document.createElement("div");
			document.body.appendChild(this.#host);
			this.#root = createRoot(this.#host);
		}
		const coords = view.coordsAtPos(state.to);
		const rows: SuggestionRow[] = state.items.map((item) => ({
			id: item.id,
			label: item.label,
			detail: item.detail,
		}));
		this.#root?.render(
			createElement(SuggestionPopup, {
				rows,
				selectedIndex: state.selectedIndex,
				state: "ready",
				emptyText: "No files found",
				anchor: { left: coords.left, top: coords.top, bottom: coords.bottom },
				onPick: (row) => {
					const index = state.items.findIndex((item) => item.id === row.id);
					if (index >= 0) chooseSuggestion(this.#view, state, index);
				},
			}),
		);
	}

	destroy(): void {
		this.#close();
	}

	#close(): void {
		this.#signature = "";
		const root = this.#root;
		const host = this.#host;
		this.#root = null;
		this.#host = null;
		if (root !== null) root.unmount();
		host?.remove();
	}
}

function createMentionPlugin(deps: FileMentionDeps): Plugin<FileMentionState> {
	return new Plugin<FileMentionState>({
		key: mentionPluginKey,
		state: {
			init: (_config, state) => stateAtEditor(state, deps),
			apply(transaction: Transaction, previous: FileMentionState, _old, next: EditorState) {
				const meta = transaction.getMeta(mentionPluginKey) as MentionMeta | undefined;
				if (meta?.type === "close") return inactive;
				if (meta?.type === "select") {
					const count = previous.items.length;
					return {
						...previous,
						selectedIndex: count === 0 ? 0 : ((meta.index ?? 0) + count) % count,
					};
				}
				const nextState = stateAtEditor(next, deps);
				if (!nextState.active) return inactive;
				return {
					...nextState,
					selectedIndex:
						previous.active && previous.query === nextState.query
							? Math.min(previous.selectedIndex, Math.max(0, nextState.items.length - 1))
							: 0,
				};
			},
		},
		props: {
			handleKeyDown(view, event) {
				const state = mentionPluginKey.getState(view.state);
				if (state === undefined || !state.active) return false;
				const count = state.items.length;
				if (event.key === "Escape") {
					view.dispatch(view.state.tr.setMeta(mentionPluginKey, { type: "close" }));
					return true;
				}
				if (event.key === "ArrowDown" && count > 0) {
					view.dispatch(
						view.state.tr.setMeta(mentionPluginKey, {
							type: "select",
							index: (state.selectedIndex + 1) % count,
						}),
					);
					return true;
				}
				if (event.key === "ArrowUp" && count > 0) {
					view.dispatch(
						view.state.tr.setMeta(mentionPluginKey, {
							type: "select",
							index: (state.selectedIndex - 1 + count) % count,
						}),
					);
					return true;
				}
				if ((event.key === "Enter" || event.key === "Tab") && count > 0) {
					return chooseSuggestion(view, state, state.selectedIndex);
				}
				return false;
			},
		},
		view: (view) => new MentionPopupView(view),
	});
}

export function createFileMention(props: FileMentionDeps): Node {
	return Node.create<FileMentionDeps>({
		name: FILE_MENTION_NODE_NAME,
		inline: true,
		group: "inline",
		atom: true,
		selectable: false,
		addOptions() {
			return props;
		},
		addAttributes() {
			return {
				path: {
					default: "",
					parseHTML: (element) => element.getAttribute("data-path") ?? "",
				},
				isDirectory: {
					default: false,
					parseHTML: (element) => element.getAttribute("data-directory") === "true",
				},
			};
		},
		parseHTML() {
			return [{ tag: "span[data-file-mention]" }];
		},
		renderHTML({ node }) {
			const path = String(node.attrs.path ?? "");
			return [
				"span",
				{
					"data-file-mention": "",
					"data-path": path,
					"data-directory": node.attrs.isDirectory === true ? "true" : "false",
					class: "inline-flex items-center rounded-sm bg-hover px-1 text-sm text-fg",
				},
				path,
			];
		},
		addProseMirrorPlugins() {
			return [createMentionPlugin(this.options)];
		},
	});
}
