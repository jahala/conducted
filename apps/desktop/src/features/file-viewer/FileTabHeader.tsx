/**
 * @feature REV-08 File tab header
 * Owns: the strip at the top of a file tab. The path, the Diff, Edit or Preview mode toggle, the
 * diff view options, and the save state.
 * Behaviour: ui-map.md 3.2, File tab ("Toggle file edit mode" is Cmd+E; "View options": "Hide
 * whitespace changes", "Wrap lines"; "Unified view", "Split view", "Entire file").
 * Children: DiffToolbar (diff/DiffToolbar.tsx) in diff mode.
 * Must handle: long paths (middle truncation, full path in a tooltip), a renamed file (old path
 * shown), edit mode disabled for deleted, binary and too-large files, an unsaved dot, a save in
 * flight, and a save error shown inline.
 * Test first: with mode "diff" and a deleted file, the Edit toggle is disabled with a reason.
 */

import { Button } from "../../ui/Button.tsx";
import { FileTextIcon } from "../../ui/icons.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { TruncatedText } from "../../ui/TruncatedText.tsx";
import { DiffToolbar } from "../diff/DiffToolbar.tsx";
import type { DiffPreferences } from "../diff/diff-types.ts";

export type FileTabMode = "diff" | "edit" | "preview";

export interface FileTabHeaderProps {
	path: string;
	oldPath: string | null;
	mode: FileTabMode;
	onModeChange: (mode: FileTabMode) => void;
	editDisabledReason: string | null;
	previewAvailable: boolean;
	preferences: DiffPreferences;
	onPreferencesChange: (next: DiffPreferences) => void;
	dirty: boolean;
	saving: boolean;
	saveError: string | null;
	onSave: () => void;
	/** Width of the tab in pixels, so Split view can disable itself when too narrow. */
	width?: number | null;
}

export function FileTabHeader({
	path,
	oldPath,
	mode,
	onModeChange,
	editDisabledReason,
	previewAvailable,
	preferences,
	onPreferencesChange,
	dirty,
	saving,
	saveError,
	onSave,
	width = null,
}: FileTabHeaderProps) {
	const editDisabled = editDisabledReason !== null;
	return (
		<div className="flex flex-col border-b border-border bg-surface">
			<div className="flex h-10 min-w-0 items-center gap-2 px-3">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-sm border border-border px-1.5">
						<FileTextIcon className="size-3.5 shrink-0 text-fg-muted" />
						<TruncatedText text={path} maxLength={80} className="text-sm text-fg" />
					</span>
					{oldPath === null ? null : (
						<span className="truncate text-xs text-fg-muted">from {oldPath}</span>
					)}
					{dirty ? (
						<span
							role="status"
							aria-label="Unsaved edits"
							className="size-2 rounded-full bg-accent"
						/>
					) : null}
				</div>

				<div className="flex shrink-0 items-center gap-0.5">
					<Button
						variant={mode === "diff" ? "secondary" : "ghost"}
						size="xs"
						aria-pressed={mode === "diff"}
						onClick={() => onModeChange("diff")}
					>
						Diff
					</Button>
					{previewAvailable ? (
						<Button
							variant={mode === "preview" ? "secondary" : "ghost"}
							size="xs"
							aria-pressed={mode === "preview"}
							onClick={() => onModeChange("preview")}
						>
							Preview
						</Button>
					) : null}
					<Button
						variant={mode === "edit" ? "secondary" : "ghost"}
						size="xs"
						aria-pressed={mode === "edit"}
						disabled={editDisabled}
						title={editDisabled ? (editDisabledReason ?? undefined) : undefined}
						onClick={() => onModeChange("edit")}
					>
						Edit
					</Button>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{dirty && mode === "edit" ? (
						<Button variant="secondary" size="xs" onClick={onSave} disabled={saving}>
							{saving ? <Spinner size="sm" label="Saving file" /> : null}
							Save
						</Button>
					) : null}
					{mode === "diff" ? (
						<DiffToolbar
							preferences={preferences}
							onChange={onPreferencesChange}
							disabled={false}
							width={width}
						/>
					) : null}
				</div>
			</div>
			{editDisabled && mode === "diff" ? (
				<p role="note" className="px-3 pb-1 text-xs text-fg-muted">
					{editDisabledReason}
				</p>
			) : null}
			{saveError === null ? null : (
				<p role="alert" className="px-3 pb-1 text-xs text-danger">
					{saveError}
				</p>
			)}
		</div>
	);
}
