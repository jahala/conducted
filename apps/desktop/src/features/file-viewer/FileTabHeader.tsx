/**
 * @feature REV-08 File tab header
 * Owns: the strip at the top of a file tab: the path chip with the file's language icon, the
 * unsaved mark, Save, Copy file contents, the view toggles (Unified, Split, Entire file, Edit,
 * Preview) and the diff's View options.
 * Behaviour: ui-map.md 3.2, File tab ("Toggle file edit mode" is Cmd+E; "View options": "Hide
 * whitespace changes", "Wrap lines"; "Unified view", "Split view", "Entire file"). Measured from
 * Conductor 0.92.1 (renderApp @9633986, @9642796): the header is 8px top and bottom, 12px left and
 * 4px right on the canvas; the file chip at the left; at the right, 8px apart, "Copy file contents"
 * as a 28px icon button, then one segmented group (32px tall, the muted fill, 2px inside) of 28px
 * icon toggles with 12px icons: the diff layouts when the file has changes, the whole file as
 * Entire file (raw), the editor, and the preview; then the vertical-dots "View options" menu.
 * Preview is offered only for a file with a rendered preview (Markdown, SVG, image, PDF, CSV,
 * video), as Conductor does (renderApp @9628678); a code file gets Entire file instead.
 * Children: DiffLayoutToggles and DiffViewOptions (diff/DiffToolbar.tsx).
 * Our design choice: the read-only whole-file view is the same "Entire file" Conductor offers, and
 * Edit is the separate editing mode (Cmd+E toggles it). The diff toggles show for a file with
 * changes, or while the diff is on show; View options shows with the diff, since its choices only
 * change the diff.
 * Must handle: long paths (middle truncation, full path in a tooltip), a renamed file (old path
 * shown), edit mode disabled for deleted, binary and too-large files, an unsaved dot, a save in
 * flight, a save error shown inline, and a file whose text is not loaded or is binary (copy disabled).
 * Test first: with mode "diff" and a deleted file, the Edit toggle is disabled with a reason.
 */

import { Button } from "../../ui/Button.tsx";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { FileTypeIcon } from "../../ui/file-icon.tsx";
import { EyeIcon, FileIcon, FileTextIcon } from "../../ui/icons.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { TruncatedText } from "../../ui/TruncatedText.tsx";
import { DiffLayoutToggles, DiffViewOptions, headerIconButtonClass } from "../diff/DiffToolbar.tsx";
import type { DiffPreferences } from "../diff/diff-types.ts";

export type FileTabMode = "diff" | "edit" | "preview" | "raw";

export interface FileTabHeaderProps {
	path: string;
	oldPath: string | null;
	mode: FileTabMode;
	onModeChange: (mode: FileTabMode) => void;
	editDisabledReason: string | null;
	previewAvailable: boolean;
	/** True for a text file, so Conductor's read-only "Entire file" view is offered. */
	rawAvailable: boolean;
	/** True when the file has changes, so the diff layouts are offered. */
	diffAvailable: boolean;
	preferences: DiffPreferences;
	onPreferencesChange: (next: DiffPreferences) => void;
	dirty: boolean;
	saving: boolean;
	saveError: string | null;
	onSave: () => void;
	/** The file's text for "Copy file contents"; null while it loads or when it is not text. */
	copyText: string | null;
	onCopy: (text: string) => unknown;
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
	rawAvailable,
	diffAvailable,
	preferences,
	onPreferencesChange,
	dirty,
	saving,
	saveError,
	onSave,
	copyText,
	onCopy,
	width = null,
}: FileTabHeaderProps) {
	const editDisabled = editDisabledReason !== null;
	const showDiffToggles = diffAvailable || mode === "diff";
	return (
		<div className="flex flex-col border-b border-border bg-canvas">
			<div className="flex min-w-0 items-center gap-2 py-2 pr-1 pl-3">
				<div className="flex min-w-32 flex-1 items-center gap-2">
					<span className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-sm border border-border px-1.5">
						<FileTypeIcon path={path} className="size-3.5" />
						<TruncatedText text={path} maxLength={80} className="text-sm text-fg" />
					</span>
					{oldPath === null ? null : (
						<span className="truncate text-xs text-fg-muted">from {oldPath}</span>
					)}
					{dirty ? (
						<span
							role="status"
							aria-label="Unsaved changes"
							className="size-2 shrink-0 rounded-full bg-accent"
						/>
					) : null}
				</div>

				<div className="flex h-8 min-w-0 shrink-0 items-center justify-end gap-2">
					{dirty && mode === "edit" ? (
						<Button variant="secondary" size="xs" onClick={onSave} disabled={saving}>
							{saving ? <Spinner size="sm" label="Saving file" /> : null}
							Save
						</Button>
					) : null}
					<CopyButton
						text={copyText ?? ""}
						onCopy={onCopy}
						iconOnly
						label="Copy file contents"
						disabled={copyText === null}
						size="sm"
						className="w-7 px-0 text-sidebar-fg-muted [&_svg]:size-3"
					/>
					<fieldset aria-label="View" className="flex h-8 items-center rounded-md bg-muted p-0.5">
						{showDiffToggles ? (
							<DiffLayoutToggles
								preferences={preferences}
								onChange={onPreferencesChange}
								disabled={false}
								width={width}
								active={mode === "diff"}
								onShowDiff={() => onModeChange("diff")}
							/>
						) : null}
						{rawAvailable ? (
							<button
								type="button"
								aria-label="Entire file"
								title="Entire file"
								aria-pressed={mode === "raw"}
								className={headerIconButtonClass}
								onClick={() => onModeChange("raw")}
							>
								<FileIcon className="size-3" />
							</button>
						) : null}
						<button
							type="button"
							aria-label="Edit"
							title={editDisabledReason ?? "Edit"}
							aria-pressed={mode === "edit"}
							disabled={editDisabled}
							className={headerIconButtonClass}
							onClick={() => onModeChange("edit")}
						>
							<FileTextIcon className="size-3" />
						</button>
						{previewAvailable ? (
							<button
								type="button"
								aria-label="Preview"
								title="Preview"
								aria-pressed={mode === "preview"}
								className={headerIconButtonClass}
								onClick={() => onModeChange("preview")}
							>
								<EyeIcon className="size-3" />
							</button>
						) : null}
					</fieldset>
					{mode === "diff" ? (
						<DiffViewOptions
							preferences={preferences}
							onChange={onPreferencesChange}
							disabled={false}
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
				<div className="px-3 pb-1">
					{/* Conductor's failed-update control (renderApp @9637835). */}
					<Button
						variant="ghost"
						size="sm"
						onClick={onSave}
						aria-label="Update failed. Retry"
						className="w-24 shrink-0 text-xs text-danger"
					>
						Retry update
					</Button>
				</div>
			)}
		</div>
	);
}
