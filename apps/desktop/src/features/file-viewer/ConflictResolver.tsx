/**
 * @feature REV-11 Resolve conflicts inline: current, incoming or both
 * Owns: the conflict rows a file view shows when its text holds conflict markers. Each row names
 * the current and incoming sides and offers the three choices; the save button resolves every row
 * in one call and refreshes the file and the change list.
 * Behaviour: inventory-controls.md "Resolve merge conflict hunks inline" and
 * inventory-messages-sidecar.md "Merge conflicts in the editor" (the three choices, saving, and
 * "Failed to save conflict resolution").
 * Data: useActions().files.resolveConflicts and the conflict parser of the workspace files service.
 * Must handle: malformed markers (a notice, no choices), a file with no markers (draws nothing),
 * choices not yet made for every conflict (save disabled), a failed save (toast), a file that
 * changed on disk after the rows were drawn (refused with the same toast, and the file is read
 * again), a save that landed but could not be staged (its own toast, not the failure one), and a
 * save that changed the file (the file text and the change list read again).
 * Our design choice: the "changed on disk" text and the "Saved, but could not stage the file"
 * title are our wording; the research names only "Failed to save conflict resolution". The check
 * reads the file just before the save. The service reads it once more to apply the choices, so a
 * write that lands between those two reads is not caught; closing that gap needs the seen text
 * in `Actions.files.resolveConflicts`.
 * Test first: a file with one conflict shows the three choices, and saving "both" writes the two
 * sides with no markers and refreshes the change list.
 */
import { appError, err, type WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ConflictChoice } from "../../core/api.ts";
import { fileQueryKey, useActions, useReadFileNow } from "../../core/hooks.ts";
import {
	CONFLICT_SAVED_NOT_STAGED,
	type ConflictHunk,
	parseConflictMarkers,
} from "../../core/services/workspace-files.ts";
import { toastError } from "../../ui/Toast.tsx";

const CHOICES: readonly { value: ConflictChoice; label: string }[] = [
	{ value: "current", label: "Accept current change" },
	{ value: "incoming", label: "Accept incoming change" },
	{ value: "both", label: "Accept both" },
];

export interface ConflictResolverProps {
	workspaceId: WorkspaceId;
	path: string;
	/** The working file's text, as the screen shows it. The rows are drawn from this text. */
	text: string;
}

export function ConflictResolver({ workspaceId, path, text }: ConflictResolverProps) {
	const actions = useActions();
	const readNow = useReadFileNow(workspaceId, path);
	const queryClient = useQueryClient();
	const parsed = useMemo(() => parseConflictMarkers(text), [text]);
	const hunks: readonly ConflictHunk[] = parsed.ok ? parsed.value : [];
	const [choices, setChoices] = useState<(ConflictChoice | null)[]>([]);
	const [saving, setSaving] = useState(false);
	const resetKey = `${String(workspaceId)}\u0000${path}\u0000${text}`;

	// A different file, or the same file after it changed, starts with no choices made.
	// biome-ignore lint/correctness/useExhaustiveDependencies: resetKey already names the inputs.
	useEffect(() => {
		setChoices(hunks.map(() => null));
	}, [resetKey]);

	if (!parsed.ok) {
		if (!text.includes("<<<<<<<")) return null;
		return (
			<div
				role="alert"
				data-conflict-resolver
				className="border-b border-border bg-surface px-4 py-3 text-sm text-danger"
			>
				{parsed.error.message}
			</div>
		);
	}
	if (hunks.length === 0) return null;

	const complete = choices.length === hunks.length && choices.every((choice) => choice !== null);

	const choose = (index: number, choice: ConflictChoice): void => {
		setChoices((current) => current.map((value, at) => (at === index ? choice : value)));
	};

	const save = async (): Promise<void> => {
		if (!complete || saving) return;
		const decided = choices.filter((choice): choice is ConflictChoice => choice !== null);
		setSaving(true);
		const result = await saveAsShown(decided);
		setSaving(false);
		if (!result.ok && result.error.code !== CONFLICT_SAVED_NOT_STAGED) {
			toastError("Failed to save conflict resolution", result.error);
			await queryClient.invalidateQueries({ queryKey: fileQueryKey(workspaceId, path) });
			return;
		}
		if (!result.ok) toastError("Saved, but could not stage the file", result.error);
		await queryClient.invalidateQueries({ queryKey: ["git"] });
		await queryClient.invalidateQueries({ queryKey: fileQueryKey(workspaceId, path) });
	};

	// The choices apply by position, so they may only land on the text the rows were drawn from.
	const saveAsShown = async (decided: ConflictChoice[]) => {
		const now = await readNow();
		if (!now.ok) return now;
		if (now.value.kind !== "text" || now.value.text !== text) {
			return err(
				appError(
					"changed_on_disk",
					`"${path}" changed on disk after its conflicts were shown. Check them again.`,
				),
			);
		}
		return actions.files.resolveConflicts(workspaceId, path, decided);
	};

	return (
		<section
			data-conflict-resolver
			aria-label="Resolve conflicts"
			className="border-b border-border bg-surface px-4 py-3"
		>
			<h2 className="text-sm font-medium text-fg">Resolve conflicts</h2>
			{hunks.map((hunk) => {
				const selected = choices[hunk.index] ?? null;
				return (
					<article
						key={hunk.index}
						data-conflict-hunk={hunk.index}
						className="mt-3 rounded-md border border-border p-3"
					>
						<p className="text-xs text-fg-muted">
							Conflict {hunk.index + 1} of {hunks.length}
						</p>
						<div className="mt-2 grid grid-cols-2 gap-3">
							<div>
								<p className="text-xs font-medium text-fg-muted">Current</p>
								<pre className="mt-1 overflow-auto whitespace-pre-wrap text-code text-fg">
									{hunk.currentText}
								</pre>
							</div>
							<div>
								<p className="text-xs font-medium text-fg-muted">Incoming</p>
								<pre className="mt-1 overflow-auto whitespace-pre-wrap text-code text-fg">
									{hunk.incomingText}
								</pre>
							</div>
						</div>
						<fieldset
							aria-label={`Conflict ${hunk.index + 1} choice`}
							className="mt-3 flex flex-wrap gap-2 border-0 p-0"
						>
							{CHOICES.map((choice) => (
								<button
									key={choice.value}
									type="button"
									aria-pressed={selected === choice.value}
									onClick={() => choose(hunk.index, choice.value)}
									className="rounded-md border border-border-strong px-2 py-1 text-xs text-fg hover:bg-hover aria-pressed:border-accent aria-pressed:bg-active"
								>
									{choice.label}
								</button>
							))}
						</fieldset>
					</article>
				);
			})}
			<div className="mt-3 flex justify-end">
				<button
					type="button"
					onClick={() => void save()}
					disabled={!complete || saving}
					className="rounded-md bg-primary-fill px-3 py-1.5 text-sm font-medium text-canvas disabled:opacity-50"
				>
					{saving ? "Saving…" : "Save resolution"}
				</button>
			</div>
		</section>
	);
}
