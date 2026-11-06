/**
 * @feature RUN-05 Annotation overlay
 * Owns: the layer over the preview where the user points at page elements, writes a note on each,
 * and sends them to the chat.
 * Behaviour: ui-map.md 3.2 (browser tab: annotation overlay, button "Add to chat");
 * native-and-sidecar-map.md (Agentation: a proxy injects the toolbar and formats annotations for
 * the agent).
 * Children: uses formatAnnotations from annotation-format.ts for the chat text.
 * Our design choice: annotations are held in this tab's state until sent, then cleared. They are
 * not stored in the database. The picker attaches to the preview frame's own document, so it works
 * while the app may script that page; a page the app may not script says annotations are
 * unavailable for it. The frame is never navigated or reloaded by this layer. The picker rebinds
 * to the frame's new document on every load, and each annotation takes a fresh random id, so a
 * reload cannot reuse one.
 * Must handle: annotating off (overlay inert, page clickable), a selector that no longer matches
 * after navigation (annotation kept with an outdated mark), many annotations (numbered, list
 * scrolls), Escape cancelling the current note, sending with no active chat (the action creates
 * none; disabled with a reason), and the page not allowing the app to attach the picker (overlay
 * says annotations are unavailable for this page).
 * Test first: two annotations produce one chat message listing both in order.
 */
import { useEffect, useId, useState } from "react";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Label, Textarea } from "../../ui/Input.tsx";
import { CloseIcon, TargetIcon } from "../../ui/icons.tsx";
import {
	formatAnnotations,
	MAX_ELEMENT_TEXT,
	type PageAnnotation,
} from "./annotation-format.ts";

export interface AnnotationOverlayProps {
	annotations: PageAnnotation[];
	canSendToChat: boolean;
	onAdd: (annotation: PageAnnotation) => void;
	onRemove: (id: string) => void;
	onSendToChat: (message: string) => void;
	onClear: () => void;
}

type PageState = "idle" | "ready" | "unavailable";

interface PendingAnnotation {
	url: string;
	selector: string;
	elementText: string | null;
}

/** The id of a selector with anything CSS reads specially escaped. */
function escapeIdentifier(value: string): string {
	return value.replace(/([^\w-])/g, "\\$1");
}

/** A short selector for the element: its id, or its path through the page. */
export function selectorFor(element: Element): string {
	if (element.id !== "") return `#${escapeIdentifier(element.id)}`;
	const parts: string[] = [];
	let current: Element | null = element;
	while (current !== null && current.tagName.toLowerCase() !== "html") {
		const tag = current.tagName.toLowerCase();
		const parent: Element | null = current.parentElement;
		if (parent === null) {
			parts.unshift(tag);
			break;
		}
		const siblings = Array.from(parent.children).filter(
			(child) => child.tagName === current?.tagName,
		);
		parts.unshift(
			siblings.length === 1 ? tag : `${tag}:nth-of-type(${siblings.indexOf(current) + 1})`,
		);
		if (parent.id !== "") {
			parts.unshift(`#${escapeIdentifier(parent.id)}`);
			break;
		}
		current = parent;
	}
	return parts.join(" > ");
}

/** The address the preview frame shows now: the live page when we may read it, else its src. */
function frameUrl(frame: HTMLIFrameElement): string {
	try {
		const live = frame.contentDocument?.location?.href;
		if (live !== undefined && live !== "" && live !== "about:blank") return live;
	} catch {
		// A page on another origin does not expose its location.
	}
	return frame.getAttribute("src") ?? "";
}

/** True when the annotation's element can still be found on the page. */
function stillMatches(document: Document, selector: string): boolean {
	try {
		return document.querySelector(selector) !== null;
	} catch {
		// A selector the page no longer accepts cannot match an element.
		return false;
	}
}

function outdatedIds(
	document: Document,
	annotations: readonly PageAnnotation[],
	url: string,
): Set<string> {
	const outdated = new Set<string>();
	for (const annotation of annotations) {
		if (annotation.url !== url) continue;
		if (!stillMatches(document, annotation.selector)) outdated.add(annotation.id);
	}
	return outdated;
}

function accentColour(): string {
	const accent = getComputedStyle(document.documentElement)
		.getPropertyValue("--color-accent")
		.trim();
	return accent === "" ? "currentColor" : accent;
}

export function AnnotationOverlay({
	annotations,
	canSendToChat,
	onAdd,
	onRemove,
	onSendToChat,
	onClear,
}: AnnotationOverlayProps) {
	const [annotating, setAnnotating] = useState(false);
	const [pending, setPending] = useState<PendingAnnotation | null>(null);
	const [note, setNote] = useState("");
	const [pageState, setPageState] = useState<PageState>("idle");
	const [outdated, setOutdated] = useState<Set<string>>(new Set());
	const noteId = useId();

	useEffect(() => {
		if (!annotating || pending !== null) return;
		const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Preview"]');
		if (frame === null) {
			setPageState("unavailable");
			return;
		}

		const colour = accentColour();
		let page: Document | null = null;
		let previousCursor = "";
		let highlighted: HTMLElement | null = null;
		let previous: { outline: string; offset: string } | null = null;

		const clearHighlight = () => {
			if (highlighted === null || previous === null) return;
			highlighted.style.outline = previous.outline;
			highlighted.style.outlineOffset = previous.offset;
			highlighted = null;
			previous = null;
		};

		const elementOf = (event: MouseEvent): Element | null => {
			const view = page?.defaultView;
			const target = event.target;
			return view !== null && view !== undefined && target instanceof view.Element ? target : null;
		};

		const onMove = (event: MouseEvent) => {
			const element = elementOf(event);
			if (element === null || element === highlighted) return;
			clearHighlight();
			highlighted = element as HTMLElement;
			previous = {
				outline: highlighted.style.outline,
				offset: highlighted.style.outlineOffset,
			};
			highlighted.style.outline = `2px solid ${colour}`;
			highlighted.style.outlineOffset = "2px";
		};

		const onClick = (event: MouseEvent) => {
			const element = elementOf(event);
			if (element === null) return;
			event.preventDefault();
			event.stopPropagation();
			clearHighlight();
			const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
			setPending({
				url: frameUrl(frame),
				selector: selectorFor(element),
				elementText: text === "" ? null : text.slice(0, MAX_ELEMENT_TEXT),
			});
			setNote("");
		};

		const detach = () => {
			if (page === null) return;
			page.removeEventListener("mousemove", onMove, true);
			page.removeEventListener("click", onClick, true);
			clearHighlight();
			if (page.body !== null) page.body.style.cursor = previousCursor;
			page = null;
		};

		// Every load may hand the frame a new document. Resolve it here, so the picker and the
		// outdated check always follow the page the user is looking at.
		const attach = () => {
			let next: Document | null;
			try {
				next = frame.contentDocument;
			} catch {
				// A page on another origin does not expose its document; the overlay says so.
				next = null;
			}
			if (next === null || next.defaultView === null) {
				detach();
				setPageState("unavailable");
				return;
			}
			if (next !== page) {
				detach();
				page = next;
				previousCursor = page.body?.style.cursor ?? "";
				if (page.body !== null) page.body.style.cursor = "crosshair";
				page.addEventListener("mousemove", onMove, true);
				page.addEventListener("click", onClick, true);
			}
			setPageState("ready");
			setOutdated(outdatedIds(next, annotations, frameUrl(frame)));
		};

		frame.addEventListener("load", attach);
		attach();

		return () => {
			frame.removeEventListener("load", attach);
			detach();
		};
	}, [annotating, pending, annotations]);

	useEffect(() => {
		if (pending === null) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			setPending(null);
			setNote("");
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [pending]);

	const save = () => {
		if (pending === null) return;
		onAdd({
			id: crypto.randomUUID(),
			url: pending.url,
			selector: pending.selector,
			elementText: pending.elementText,
			note,
			stillMatches: true,
		});
		setPending(null);
		setNote("");
	};

	const send = () => {
		const message = formatAnnotations(
			annotations.map((annotation) => ({
				...annotation,
				stillMatches: annotation.stillMatches && !outdated.has(annotation.id),
			})),
		);
		if (message === null) return;
		onSendToChat(message);
	};

	return (
		<div
			data-region="annotation-overlay"
			className="pointer-events-none absolute inset-0 z-10 flex flex-col items-end gap-1 p-2"
		>
			<div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-raised p-1 shadow-popover">
				<Button
					variant={annotating ? "default" : "secondary"}
					size="xs"
					aria-pressed={annotating}
					onClick={() => {
						setAnnotating((current) => !current);
						setPending(null);
						setNote("");
					}}
				>
					<TargetIcon className="size-3.5" />
					{annotating ? "Done" : "Annotate"}
				</Button>
				<span className="min-w-6 px-1 text-center text-xs text-fg-muted">{annotations.length}</span>
				<Button
					variant="secondary"
					size="xs"
					disabled={!canSendToChat || annotations.length === 0}
					onClick={send}
				>
					Add to chat
				</Button>
				{annotations.length === 0 ? null : (
					<Button variant="ghost" size="xs" onClick={onClear}>
						Clear
					</Button>
				)}
			</div>

			{canSendToChat ? null : (
				<p className="pointer-events-auto rounded-md bg-raised px-2 py-1 text-xs text-fg-muted shadow-xs">
					Open a chat to add annotations.
				</p>
			)}
			{annotating && pageState === "unavailable" ? (
				<p className="pointer-events-auto max-w-72 rounded-md bg-raised px-2 py-1 text-xs text-fg-muted shadow-xs">
					Annotations aren't available for this page.
				</p>
			) : null}
			{annotating && pageState === "ready" && pending === null ? (
				<p className="pointer-events-auto rounded-md bg-raised px-2 py-1 text-xs text-fg-muted shadow-xs">
					Select an element in the page to annotate it.
				</p>
			) : null}

			{pending === null ? null : (
				<div className="pointer-events-auto flex w-72 flex-col gap-2 rounded-lg border border-border bg-raised p-2 shadow-popover">
					<p className="truncate font-mono text-xs text-fg-muted">{pending.selector}</p>
					<div className="flex flex-col gap-1">
						<Label htmlFor={noteId}>Note</Label>
						<Textarea
							id={noteId}
							aria-label="Note"
							value={note}
							autoFocus
							onChange={(event) => setNote(event.target.value)}
						/>
					</div>
					<div className="flex justify-end gap-1">
						<Button
							variant="ghost"
							size="xs"
							onClick={() => {
								setPending(null);
								setNote("");
							}}
						>
							Cancel
						</Button>
						<Button size="xs" onClick={save}>
							Save annotation
						</Button>
					</div>
				</div>
			)}

			{annotations.length === 0 ? null : (
				<div className="pointer-events-auto max-h-64 w-72 overflow-auto rounded-lg border border-border bg-raised shadow-popover">
					<ol>
						{annotations.map((annotation, index) => (
							<li
								key={annotation.id}
								className="flex items-start gap-2 border-b border-border p-2 last:border-b-0"
							>
								<span className="mt-0.5 min-w-4 text-right text-xs text-fg-muted">{index + 1}</span>
								<div className="min-w-0 flex-1">
									<p className="truncate font-mono text-xs text-fg-muted">{annotation.selector}</p>
									{annotation.elementText === null ? null : (
										<p className="truncate text-xs text-fg-muted">{annotation.elementText}</p>
									)}
									{annotation.note === "" ? null : (
										<p className="text-xs text-fg">{annotation.note}</p>
									)}
									{annotation.stillMatches && !outdated.has(annotation.id) ? null : (
										<div className="mt-1">
											<Badge tone="warning">Outdated</Badge>
										</div>
									)}
								</div>
								<IconButton
									label={`Remove annotation ${index + 1}`}
									size="xs"
									icon={<CloseIcon />}
									onClick={() => onRemove(annotation.id)}
								/>
							</li>
						))}
					</ol>
				</div>
			)}
		</div>
	);
}
