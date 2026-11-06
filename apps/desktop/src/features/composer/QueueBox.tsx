/**
 * @feature CHAT-04 Follow-up queue
 * Owns: The box above the composer that lists queued messages, with edit, reorder, delete, pause
 * and send-as-steer.
 * Behaviour: ui-map.md 3.4 (queue box role listbox 'Queued messages'; header status and 'Resume'
 * when paused, 'Collapse queue' or 'Expand queue'; rows with attachment thumbs, preview, Edit or
 * 'Save edit', Steer, Delete; keys E edit, Backspace delete, Enter steer, Escape cancel edit,
 * Cmd+Enter 'Save and steer'; reorder by drag; errors such as 'Failed to delete queued message').
 * Our design choice: OpenCode and Pi cannot be steered: their Steer button is disabled with 'This
 * agent can't be steered'. The default follow-up behaviour (queue or steer) is the setting
 * 'Follow-up behavior'.
 * Must handle: Empty queue (renders nothing); paused queue (shows 'Resume'); a message that failed
 * to send (row shows the error and Retry); editing a message that the agent has just started (the
 * edit is refused with a message); drag reorder fails (order returns, toast); many rows (more than
 * three start collapsed to the first three, with 'Show all N').
 * Test first: Deleting a queued message calls sessions.queue.remove(id); a failure restores the row
 * and shows 'Failed to delete queued message'.
 */

import type { MessageId, SessionId } from "@conducted/shared";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import type { QueuedMessage } from "../../core/model.ts";
import { agentCanSteer, byPosition } from "../../core/services/follow-up-queue.ts";
import { Button } from "../../ui/Button.tsx";
import { toastError } from "../../ui/Toast.tsx";

export interface QueueBoxProps {
	sessionId: SessionId;
}

const QUEUE_DRAG_MIME = "application/x-conducted-queued-message";
/** Rows beyond this count stay folded away until the queue is expanded. */
const COLLAPSED_ROW_LIMIT = 3;

function fileName(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] ?? path;
}

export function QueueBox({ sessionId }: QueueBoxProps) {
	const actions = useActions();
	const { services } = useServices();
	const rows = useStore(services.followUpQueue.store, (state) => state.bySession[sessionId] ?? []);
	const paused = useStore(
		services.followUpQueue.store,
		(state) => state.pausedSessionIds[sessionId] === true,
	);
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	// Null until the user folds or unfolds the box; until then a long queue starts folded.
	const [collapsedChoice, setCollapsed] = useState<boolean | null>(null);
	const [selectedId, setSelectedId] = useState<MessageId | null>(null);
	const [editingId, setEditingId] = useState<MessageId | null>(null);
	const [editText, setEditText] = useState("");
	const [draggingId, setDraggingId] = useState<MessageId | null>(null);

	const ordered = useMemo(() => [...rows].sort(byPosition), [rows]);
	const collapsed = collapsedChoice ?? ordered.length > COLLAPSED_ROW_LIMIT;
	const canSteer = session === undefined || agentCanSteer(session.config);
	const editing = ordered.find((row) => row.id === editingId) ?? null;
	const selected = ordered.find((row) => row.id === selectedId) ?? null;
	const shown = collapsed ? ordered.slice(0, COLLAPSED_ROW_LIMIT) : ordered;

	useEffect(() => {
		void services.followUpQueue.load(sessionId).then((result) => {
			if (!result.ok) toastError("Couldn't load the queued messages", result.error);
		});
	}, [services, sessionId]);

	useEffect(() => {
		if (ordered.length === 0) {
			if (selectedId !== null) setSelectedId(null);
			return;
		}
		if (selectedId === null || !ordered.some((row) => row.id === selectedId)) {
			setSelectedId(ordered[0]?.id ?? null);
		}
	}, [ordered, selectedId]);

	useEffect(() => {
		if (editingId !== null && !ordered.some((row) => row.id === editingId)) {
			setEditingId(null);
			setEditText("");
		}
	}, [editingId, ordered]);

	const startEdit = (row: QueuedMessage): void => {
		setSelectedId(row.id);
		setEditingId(row.id);
		setEditText(row.text);
	};

	const cancelEdit = (): void => {
		setEditingId(null);
		setEditText("");
	};

	const saveEdit = async (row: QueuedMessage, andSteer: boolean): Promise<void> => {
		const text = editText.trim();
		if (text.length === 0) return;
		const saved = await actions.sessions.queue.edit(row.id, text);
		if (!saved.ok) {
			toastError("Couldn't save the queued message", saved.error);
			return;
		}
		cancelEdit();
		if (!andSteer) return;
		const steered = await actions.sessions.queue.sendNowAsSteer(row.id);
		if (!steered.ok) toastError("Failed to steer queued message", steered.error);
	};

	const remove = (row: QueuedMessage): void => {
		void actions.sessions.queue.remove(row.id).then((result) => {
			if (!result.ok) toastError("Failed to delete queued message", result.error);
			else if (editingId === row.id) cancelEdit();
		});
	};

	const steer = (row: QueuedMessage): void => {
		void actions.sessions.queue.sendNowAsSteer(row.id).then((result) => {
			if (!result.ok) toastError("Failed to steer queued message", result.error);
			else if (editingId === row.id) cancelEdit();
		});
	};

	const resume = (): void => {
		void actions.sessions.queue.setPaused(sessionId, false).then((result) => {
			if (!result.ok) toastError("Failed to resume queue", result.error);
		});
	};

	const retry = (row: QueuedMessage): void => {
		void services.followUpQueue.retry(row.id).then((result) => {
			if (!result.ok) toastError("Failed to retry message", result.error);
		});
	};

	const reorderOnDrop = (target: QueuedMessage, after: boolean, draggedId: string): void => {
		if (draggedId === target.id) return;
		const waiting = ordered.filter((row) => row.state === "waiting");
		const dragged = waiting.find((row) => row.id === draggedId);
		const without = waiting.filter((row) => row.id !== draggedId);
		const targetIndex = without.findIndex((row) => row.id === target.id);
		if (dragged === undefined || targetIndex < 0) return;
		const at = Math.max(0, after ? targetIndex + 1 : targetIndex);
		const next = [...without.slice(0, at), dragged, ...without.slice(at)];
		void actions.sessions.queue
			.reorder(
				sessionId,
				next.map((row) => row.id),
			)
			.then((result) => {
				if (!result.ok) toastError("Failed to reorder queued messages", result.error);
			});
	};

	useCommandHandler("chat.queue.steer", "area", () => {
		if (selected === null || selected.state !== "waiting" || editingId !== null) return false;
		steer(selected);
		return true;
	});
	useCommandHandler("chat.queue.edit", "area", () => {
		if (selected === null || selected.state !== "waiting" || editingId !== null) return false;
		startEdit(selected);
		return true;
	});
	useCommandHandler("chat.queue.delete", "area", () => {
		if (selected === null) return false;
		remove(selected);
		return true;
	});
	useCommandHandler("chat.queue.saveEdit", "area", () => {
		if (editing === null) return false;
		void saveEdit(editing, false);
		return true;
	});
	useCommandHandler("chat.queue.saveAndSteer", "area", () => {
		if (editing === null) return false;
		void saveEdit(editing, true);
		return true;
	});
	useCommandHandler("chat.queue.cancelEdit", "area", () => {
		if (editingId === null) return false;
		cancelEdit();
		return true;
	});

	if (ordered.length === 0) return null;

	return (
		<section className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-2">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-fg-muted">
					{paused ? "Queue paused" : `${ordered.length} queued`}
				</span>
				<div className="flex items-center gap-1">
					{paused ? (
						<Button size="xs" variant="secondary" onClick={resume}>
							Resume
						</Button>
					) : null}
					<Button
						size="xs"
						variant="ghost"
						aria-label={collapsed ? "Expand queue" : "Collapse queue"}
						title={collapsed ? "Expand queue" : "Collapse queue"}
						onClick={() => setCollapsed(!collapsed)}
					>
						{collapsed ? "Expand" : "Collapse"}
					</Button>
				</div>
			</div>

			{editing === null ? null : (
				<div className="flex items-center justify-between gap-2 rounded-md bg-highlight-surface px-2 py-1 text-xs text-highlight-fg">
					<span>Editing queued message</span>
					<Button size="xs" variant="ghost" onClick={cancelEdit}>
						Cancel
					</Button>
				</div>
			)}

			<div role="listbox" aria-label="Queued messages" className="flex flex-col gap-1">
				{shown.map((row) => {
					const isEditing = row.id === editingId;
					const isSelected = row.id === selectedId;
					return (
						<div
							key={row.id}
							role="option"
							aria-selected={isSelected}
							tabIndex={0}
							data-command-scope={isSelected ? "chat-queue" : undefined}
							draggable={row.state === "waiting" && !isEditing}
							onClick={() => setSelectedId(row.id)}
							onFocus={() => setSelectedId(row.id)}
							onKeyUp={() => setSelectedId(row.id)}
							onDragStart={(event) => {
								if (row.state !== "waiting") return;
								event.dataTransfer?.setData(QUEUE_DRAG_MIME, row.id);
								event.dataTransfer?.setData("text/plain", row.id);
								setDraggingId(row.id);
							}}
							onDragEnd={() => setDraggingId(null)}
							onDragOver={(event) => {
								if (draggingId === null) return;
								event.preventDefault();
							}}
							onDrop={(event) => {
								event.preventDefault();
								const carried = event.dataTransfer?.getData(QUEUE_DRAG_MIME);
								const id = (carried === "" ? null : carried) ?? draggingId;
								if (id === null || id === row.id) {
									setDraggingId(null);
									return;
								}
								const rect = event.currentTarget.getBoundingClientRect();
								const after = rect.height > 0 && event.clientY > rect.top + rect.height / 2;
								const source = ordered.find((entry) => entry.id === id) ?? null;
								if (source !== null) reorderOnDrop(row, after, source.id);
								setDraggingId(null);
							}}
							className="group flex flex-col gap-1 rounded-md border border-transparent bg-canvas px-2 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<div className="flex items-start justify-between gap-2">
								{isEditing ? (
									<textarea
										data-command-scope="chat-queue-edit"
										aria-label="Queued message text"
										value={editText}
										onChange={(event) => setEditText(event.target.value)}
										rows={2}
										className="min-h-8 flex-1 resize-none rounded-sm border border-border bg-surface px-2 py-1 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
									/>
								) : (
									<p className="flex-1 whitespace-pre-wrap break-words text-sm text-fg">
										{row.text}
									</p>
								)}
								<span
									role="img"
									aria-label="Reorder"
									className="cursor-grab select-none text-fg-subtle"
								>
									⠿
								</span>
							</div>

							{row.attachmentPaths.length === 0 ? null : (
								<ul aria-label="Queued attachments" className="flex flex-wrap gap-1">
									{row.attachmentPaths.map((path) => (
										<li
											key={path}
											title={path}
											className="max-w-40 truncate rounded-sm bg-surface px-1.5 py-0.5 text-xs text-fg-muted"
										>
											{fileName(path)}
										</li>
									))}
								</ul>
							)}

							{row.state === "failed" ? (
								<div className="flex items-center justify-between gap-2 text-xs text-danger">
									<span>{row.lastError ?? "This message was not sent."}</span>
									<Button size="xs" variant="ghost" onClick={() => retry(row)}>
										Retry
									</Button>
								</div>
							) : null}

							<div className="flex flex-wrap items-center gap-1">
								{isEditing ? (
									<>
										<Button size="xs" variant="secondary" onClick={() => void saveEdit(row, false)}>
											Save edit
										</Button>
										<Button size="xs" variant="ghost" onClick={() => void saveEdit(row, true)}>
											Save and steer
										</Button>
									</>
								) : (
									<Button
										size="xs"
										variant="ghost"
										disabled={row.state === "sending"}
										onClick={() => startEdit(row)}
									>
										Edit
									</Button>
								)}
								{isEditing ? null : (
									<Button
										size="xs"
										variant="ghost"
										disabled={!canSteer || row.state === "sending"}
										title={canSteer ? undefined : "This agent can't be steered"}
										onClick={() => steer(row)}
									>
										Steer
									</Button>
								)}
								<Button
									size="xs"
									variant="ghost"
									disabled={row.state === "sending"}
									onClick={() => remove(row)}
								>
									Delete
								</Button>
								{canSteer ? null : (
									<span className="text-xs text-fg-muted">This agent can't be steered</span>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{collapsed && ordered.length > COLLAPSED_ROW_LIMIT ? (
				<Button size="xs" variant="ghost" onClick={() => setCollapsed(false)}>
					Show all {ordered.length}
				</Button>
			) : null}
		</section>
	);
}
