/**
 * @feature COMP-05 # PR and issue mentions
 * Owns: The '#' trigger: search of pull requests and issues, and the chip it inserts. Choosing a
 * row first writes that item's context file into the workspace, then inserts a chip. A pull
 * request's chip carries the `⟦pr:<n>⟧` token the sidecar expands; an issue's chip carries the
 * `⟦file:<path>⟧` token of the context file just written.
 * Behaviour: ui-map.md 3.5 ('#': pull requests and issues; selecting writes a PR context file and
 * inserts a chip), services-map.md 5B.8.2 (GitHub's open issues), 5B.8.3 (`.context/pull-requests/
 * <n>.md` and `[GITHUB]-<n>.md`).
 * Data: `search` is passed in and asks the workspace's GitHub and Linear sources; `attach` writes
 * the chosen item's context file and returns its workspace-relative path; `onError` reports a
 * failed write so the composer shows "Failed to save PR context".
 * Our design choice: the trigger is one ProseMirror plugin rather than TipTap's suggestion helper,
 * because the editor carries no extra TipTap packages. The plugin holds the query, the request
 * number, the matching rows and the selected row, and draws them with SuggestionPopup. Only the
 * newest search answer changes the rows: a results transaction carries the request number it
 * belongs to, and an older one is dropped. A short pause after the last key limits the requests.
 * Must handle: a source that cannot be searched (its notice shows above the rows); a failed search
 * (its message replaces the rows); no matches; Escape closes the popup and keeps the typed '#';
 * Arrow keys wrap; Enter and Tab choose; a trigger inside a word does not open; a context file that
 * cannot be written (no chip, `onError` called).
 * Test first: Typing '#12' offers PR 12 when it exists; choosing it inserts a chip with the number
 * and title.
 */
import { formatFileMention, formatPullRequestMention } from "@conducted/protocol";
import { type AppError, appError, err, messageOf, type Result } from "@conducted/shared";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Node } from "@tiptap/react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SuggestionPopup, type SuggestionRow } from "./SuggestionPopup.tsx";

export interface PrMentionItem {
	kind: "pull_request" | "issue";
	provider: "github" | "linear";
	/** The pull request or GitHub issue number; null for a Linear issue. */
	number: number | null;
	/** What the user sees: "#12" or "ENG-12". */
	identifier: string;
	title: string;
	/** The item's web address, when its source reports one. */
	url?: string;
	/** The provider's id, for attaching an issue. */
	id: string;
}

export interface PrMentionSearchResult {
	items: readonly PrMentionItem[];
	/** One line above the rows when a source is unavailable but another can answer. */
	notice?: string;
}

export interface PrMentionDeps {
	search: (query: string) => Promise<Result<PrMentionSearchResult>>;
	/** Writes the item's context file and returns its workspace-relative path. */
	attach: (item: PrMentionItem) => Promise<Result<string>>;
	/** Reports a context file that could not be written. */
	onError: (error: AppError) => void;
}

export const PR_MENTION_NODE_NAME = "prMention";
export const PR_MENTION_LIMIT = 20;
const SEARCH_PAUSE_MS = 120;
const TRIGGER = /(?:^|[\s([{])#([^\s#]*)$/;

interface PrMentionState {
	active: boolean;
	query: string;
	/** Document position of the typed '#'. */
	from: number;
	/** Document position just after the query. */
	to: number;
	selectedIndex: number;
	/** The search this state belongs to. A result for an older request is dropped. */
	request: number;
	phase: "loading" | "ready" | "error";
	items: readonly PrMentionItem[];
	notice: string | undefined;
	error: string | undefined;
}

type PrMentionMeta =
	| { type: "select"; index: number }
	| { type: "close" }
	| {
			type: "results";
			request: number;
			items: readonly PrMentionItem[];
			notice?: string;
			error?: string;
	  };

const mentionPluginKey = new PluginKey<PrMentionState>("conductedPrMention");

const inactive: PrMentionState = {
	active: false,
	query: "",
	from: 0,
	to: 0,
	selectedIndex: 0,
	request: 0,
	phase: "ready",
	items: [],
	notice: undefined,
	error: undefined,
};

/** The label a chip shows: the item's identifier, then its title. */
function chipLabel(item: PrMentionItem): string {
	return `${item.identifier} ${item.title}`;
}

/** Reads the '#' trigger from the text before the caret. */
function stateAtEditor(state: EditorState, previousRequest: number): PrMentionState {
	if (!state.selection.empty) return inactive;
	const { $from } = state.selection;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
	const match = TRIGGER.exec(before);
	if (match === null) return inactive;
	const query = match[1] ?? "";
	return {
		active: true,
		query,
		from: $from.pos - (query.length + 1),
		to: $from.pos,
		selectedIndex: 0,
		request: previousRequest + 1,
		phase: "loading",
		items: [],
		notice: undefined,
		error: undefined,
	};
}

function createMentionPlugin(deps: PrMentionDeps): Plugin<PrMentionState> {
	return new Plugin<PrMentionState>({
		key: mentionPluginKey,
		state: {
			init: (_config, state) => stateAtEditor(state, 0),
			apply(transaction: Transaction, previous: PrMentionState, _old, next: EditorState) {
				const meta = transaction.getMeta(mentionPluginKey) as PrMentionMeta | undefined;
				if (meta?.type === "close") return inactive;
				if (meta?.type === "select") {
					const count = previous.items.length;
					return {
						...previous,
						selectedIndex: count === 0 ? 0 : ((meta.index ?? 0) + count) % count,
					};
				}
				if (meta?.type === "results") {
					if (meta.request !== previous.request) return previous;
					return {
						...previous,
						phase: meta.error === undefined ? "ready" : "error",
						items: [...meta.items].slice(0, PR_MENTION_LIMIT),
						notice: meta.notice,
						error: meta.error,
					};
				}
				const nextState = stateAtEditor(next, previous.request);
				if (!nextState.active) return inactive;
				if (previous.active && previous.query === nextState.query) {
					return {
						...nextState,
						request: previous.request,
						phase: previous.phase,
						items: previous.items,
						notice: previous.notice,
						error: previous.error,
						selectedIndex: Math.min(previous.selectedIndex, Math.max(0, previous.items.length - 1)),
					};
				}
				return nextState;
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
					const item = state.items[state.selectedIndex];
					if (item === undefined) return false;
					void chooseItem(view, item, state.request, deps);
					return true;
				}
				return false;
			},
		},
		view: (view) => new PrMentionPopupView(view, deps),
	});
}

/** Writes the item's context file, then inserts the chip that names it. */
async function chooseItem(
	view: EditorView,
	item: PrMentionItem,
	request: number,
	deps: PrMentionDeps,
): Promise<void> {
	const attached = await deps.attach(item);
	if (view.isDestroyed) return;
	if (!attached.ok) {
		deps.onError(attached.error);
		return;
	}
	const current = mentionPluginKey.getState(view.state);
	if (current === undefined || !current.active || current.request !== request) return;
	const type = view.state.schema.nodes[PR_MENTION_NODE_NAME];
	if (type === undefined) return;
	const token =
		item.kind === "pull_request" && item.number !== null
			? formatPullRequestMention(item.number)
			: formatFileMention(attached.value);
	const chip = type.create({ token, label: chipLabel(item) });
	const transaction = view.state.tr;
	const end = current.from + chip.nodeSize + 1;
	transaction.replaceWith(current.from, current.to, chip);
	transaction.insertText(" ", current.from + chip.nodeSize);
	transaction.setSelection(TextSelection.near(transaction.doc.resolve(end)));
	view.dispatch(transaction.scrollIntoView());
}

class PrMentionPopupView {
	#view: EditorView;
	#deps: PrMentionDeps;
	#host: HTMLDivElement | null = null;
	#root: Root | null = null;
	#signature = "";
	#startedRequest = -1;
	#timer: ReturnType<typeof setTimeout> | null = null;

	constructor(view: EditorView, deps: PrMentionDeps) {
		this.#view = view;
		this.#deps = deps;
		this.update(view);
	}

	update(view: EditorView): void {
		this.#view = view;
		const state = mentionPluginKey.getState(view.state);
		if (state === undefined || !state.active) {
			this.#startedRequest = -1;
			this.#clearTimer();
			this.#close();
			return;
		}
		if (state.request !== this.#startedRequest) {
			this.#startedRequest = state.request;
			this.#startSearch(state.request, state.query);
		}
		const signature = `${state.query}|${state.phase}|${state.selectedIndex}|${state.items
			.map((item) => item.id)
			.join(",")}|${state.notice ?? ""}|${state.error ?? ""}`;
		if (signature === this.#signature) return;
		this.#signature = signature;
		if (this.#host === null) {
			this.#host = document.createElement("div");
			document.body.appendChild(this.#host);
			this.#root = createRoot(this.#host);
		}
		const coords = view.coordsAtPos(state.to);
		const rows: SuggestionRow[] = state.items.map((item) => ({
			id: `${item.kind}:${item.provider}:${item.id}`,
			label: item.identifier,
			detail: item.title,
		}));
		this.#root?.render(
			createElement(SuggestionPopup, {
				rows,
				selectedIndex: state.selectedIndex,
				state: state.phase,
				emptyText: state.error ?? "No pull requests or issues found",
				notice: state.notice,
				anchor: { left: coords.left, top: coords.top, bottom: coords.bottom },
				onPick: (row) => {
					const index = state.items.findIndex(
						(item) => `${item.kind}:${item.provider}:${item.id}` === row.id,
					);
					if (index < 0) return;
					const item = state.items[index];
					if (item !== undefined) void chooseItem(this.#view, item, state.request, this.#deps);
				},
			}),
		);
	}

	destroy(): void {
		this.#clearTimer();
		this.#close();
	}

	#startSearch(request: number, query: string): void {
		this.#clearTimer();
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.#runSearch(request, query);
		}, SEARCH_PAUSE_MS);
	}

	async #runSearch(request: number, query: string): Promise<void> {
		let result: Result<PrMentionSearchResult>;
		try {
			result = await this.#deps.search(query);
		} catch (cause) {
			result = err(appError("pr_mention_search_failed", messageOf(cause)));
		}
		if (this.#view.isDestroyed) return;
		const current = mentionPluginKey.getState(this.#view.state);
		if (current === undefined || !current.active || current.request !== request) return;
		this.#view.dispatch(
			this.#view.state.tr.setMeta(mentionPluginKey, {
				type: "results",
				request,
				items: result.ok ? result.value.items : [],
				notice: result.ok ? result.value.notice : undefined,
				error: result.ok ? undefined : result.error.message,
			} satisfies PrMentionMeta),
		);
	}

	#clearTimer(): void {
		if (this.#timer === null) return;
		clearTimeout(this.#timer);
		this.#timer = null;
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

export function createPrMention(props: PrMentionDeps): Node {
	return Node.create<PrMentionDeps>({
		name: PR_MENTION_NODE_NAME,
		inline: true,
		group: "inline",
		atom: true,
		selectable: false,
		addOptions() {
			return props;
		},
		addAttributes() {
			return {
				token: {
					default: "",
					parseHTML: (element) => element.getAttribute("data-token") ?? "",
				},
				label: {
					default: "",
					parseHTML: (element) => element.getAttribute("data-label") ?? "",
				},
			};
		},
		parseHTML() {
			return [{ tag: "span[data-pr-mention]" }];
		},
		renderHTML({ node }) {
			const token = String(node.attrs.token ?? "");
			const label = String(node.attrs.label ?? "");
			return [
				"span",
				{
					"data-pr-mention": "",
					"data-token": token,
					"data-label": label,
					class: "inline-flex items-center rounded-sm bg-hover px-1 text-sm text-fg",
				},
				label,
			];
		},
		renderText({ node }) {
			return String(node.attrs.token ?? "");
		},
		addProseMirrorPlugins() {
			return [createMentionPlugin(this.options)];
		},
	});
}
