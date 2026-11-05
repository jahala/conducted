/**
 * @feature SET-07 Files to copy field
 * Owns: the editor for the list of file paths or patterns copied from the main clone into each new
 * workspace, with a preview of what matches.
 * Behaviour: ui-map.md 6, "Misc (repo)" (Files to copy) and "Environment page" ("Detecting files to
 * copy...", "Using .worktreeinclude from this repository..."); services-map.md 4.2.3
 * (file_include_globs).
 * Must handle: a pattern with no match (shown, not an error), a pattern that reaches outside the
 * repository (refused), a huge match list (first 50 and a count), detection in progress, and a
 * `.worktreeinclude` file taking over (the field says where the list comes from, read-only).
 * Test first: the pattern "../secret" is refused.
 */
import { useId, useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label } from "../../../ui/Input.tsx";

/** The most matched paths shown; the rest are reported as a count. */
export const COPY_PREVIEW_LIMIT = 50;

/** True for a path that would leave the repository root. */
export function isOutsideRepository(pattern: string): boolean {
	const trimmed = pattern.trim();
	if (trimmed === "") return false;
	if (trimmed.startsWith("/") || trimmed.startsWith("~/")) return true;
	return trimmed.split(/[\\/]/).some((part) => part === "..");
}

export interface FilesToCopyFieldProps {
	patterns: string[];
	/** Null while no detector is available, so the field shows no false result. */
	matches: { state: "detecting" } | { state: "ready"; paths: string[] } | null;
	source: "settings" | "worktreeinclude";
	onChange: (patterns: string[]) => void;
}

export function FilesToCopyField({
	patterns,
	matches,
	source,
	onChange,
}: FilesToCopyFieldProps) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const inputId = useId();
	const readOnly = source === "worktreeinclude";

	const add = () => {
		const pattern = draft.trim();
		if (pattern === "") return;
		if (isOutsideRepository(pattern)) {
			setError("Patterns must stay inside the repository.");
			return;
		}
		if (patterns.includes(pattern)) {
			setDraft("");
			return;
		}
		setError(null);
		setDraft("");
		onChange([...patterns, pattern]);
	};

	return (
		<div className="flex flex-col gap-3">
			{readOnly ? (
				<p className="text-sm text-fg-muted">
					Using .worktreeinclude from this repository. Edit that file to change the list.
				</p>
			) : (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={inputId}>Add a file or pattern</Label>
					<div className="flex items-center gap-2">
						<Input
							id={inputId}
							value={draft}
							placeholder=".env*"
							error={error ?? undefined}
							onChange={(event) => {
								setDraft(event.target.value);
								setError(null);
							}}
							onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								add();
							}}
						/>
						<Button variant="secondary" onClick={add}>
							Add
						</Button>
					</div>
				</div>
			)}

			{patterns.length === 0 ? (
				<p className="text-sm text-fg-muted">No files are copied into new workspaces.</p>
			) : (
				<ul aria-label="Files to copy" className="flex flex-col gap-1">
					{patterns.map((pattern) => (
						<li
							key={pattern}
							className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5"
						>
							<code className="min-w-0 truncate font-mono text-xs text-fg">{pattern}</code>
							{readOnly ? null : (
								<Button
									size="xs"
									variant="ghost"
									aria-label={`Remove ${pattern}`}
									onClick={() => onChange(patterns.filter((entry) => entry !== pattern))}
								>
									Remove
								</Button>
							)}
						</li>
					))}
				</ul>
			)}

			{matches?.state === "detecting" ? (
				<p role="status" className="text-sm text-fg-muted">
					Detecting files to copy...
				</p>
			) : null}

			{matches?.state === "ready" ? <MatchPreview paths={matches.paths} patterns={patterns} /> : null}
		</div>
	);
}

function MatchPreview({ paths, patterns }: { paths: string[]; patterns: string[] }) {
	if (paths.length === 0) {
		return (
			<p className="text-sm text-fg-muted">
				{patterns.length === 0 ? "No files are copied into new workspaces." : "No files match these patterns."}
			</p>
		);
	}
	const shown = paths.slice(0, COPY_PREVIEW_LIMIT);
	return (
		<div className="flex flex-col gap-1">
			<p className="text-sm text-fg-muted">
				{paths.length === 1 ? "1 file will be copied" : `${paths.length} files will be copied`}
			</p>
			<ul aria-label="Matching files" className="max-h-40 overflow-y-auto rounded-md bg-muted p-2">
				{shown.map((path) => (
					<li key={path} className="truncate font-mono text-xs text-fg-muted">
						{path}
					</li>
				))}
			</ul>
			{paths.length > shown.length ? (
				<p className="text-xs text-fg-muted">
					{paths.length - shown.length} more files are not shown.
				</p>
			) : null}
		</div>
	);
}
