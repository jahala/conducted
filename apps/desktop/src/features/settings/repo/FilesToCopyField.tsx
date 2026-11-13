/**
 * @feature SET-07 Files to copy field
 * Owns: the editor for the list of file paths or patterns copied from the main clone into each new
 * workspace, with a preview of what matches.
 * Behaviour: ui-map.md 6, "Misc (repo)" (Files to copy) and "Environment page" ("Detecting files to
 * copy...", "Using .worktreeinclude from this repository..."); services-map.md 4.2.3
 * (file_include_globs). A repository's `.worktreeinclude` replaces the settings list (copyPatterns,
 * as Conductor picks it, main @3729312), so while it exists the field shows its patterns locked
 * under Conductor's note, renderApp @11274850.
 * Must handle: a pattern with no match (shown as "No matching gitignored files found."), a pattern
 * that reaches outside the repository (refused), a huge match list (first 50 and a count), a
 * detection that fails ("Could not preview files to copy.") and its Refresh, and a saved list the
 * caller supplies. The caller supplies the preview (RepoMiscPage asks RepoService.copyPreview).
 * Test first: the pattern "../secret" is refused.
 */
import { useId, useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Input, Label, Textarea } from "../../../ui/Input.tsx";

/** The most matched paths shown; the rest are reported as a count. */
export const COPY_PREVIEW_LIMIT = 50;

/** True for a path that would leave the repository root. */
export function isOutsideRepository(pattern: string): boolean {
	const trimmed = pattern.trim().replace(/^!+/, "");
	if (trimmed === "") return false;
	if (trimmed.startsWith("/") || trimmed.startsWith("~/")) return true;
	return trimmed.split(/[\\/]/).some((part) => part === "..");
}

export interface FilesToCopyFieldProps {
	patterns: string[];
	/** The patterns of the repository's `.worktreeinclude`, which replace `patterns`; null without one. */
	worktreeInclude?: readonly string[] | null;
	/**
	 * What the repository's ignored files match: detecting, the paths, a failure, or null while no
	 * detector is available, so the field shows no false result.
	 */
	matches: { state: "detecting" } | { state: "ready"; paths: string[] } | { state: "error" } | null;
	onChange: (patterns: string[]) => void;
	/** Asks for the preview again. Left out when the caller has no detector. */
	onRefresh?: () => void;
}

export function FilesToCopyField({
	patterns,
	worktreeInclude = null,
	matches,
	onChange,
	onRefresh,
}: FilesToCopyFieldProps) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const inputId = useId();

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

	if (worktreeInclude !== null) {
		return (
			<div className="flex flex-col gap-3">
				<div className="relative">
					<Textarea
						aria-label="Files to copy"
						value={worktreeInclude.join("\n")}
						readOnly
						className="min-h-[120px] w-full resize-none bg-muted font-mono text-xs text-fg-muted"
					/>
					<p className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-muted/80 px-4 text-center text-xs text-fg-muted">
						Using .worktreeinclude from this repository. Remove that file to edit these patterns
						here.
					</p>
				</div>
				<CopyMatches matches={matches} onRefresh={onRefresh} />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
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
							<Button
								size="xs"
								variant="ghost"
								aria-label={`Remove ${pattern}`}
								onClick={() => onChange(patterns.filter((entry) => entry !== pattern))}
							>
								Remove
							</Button>
						</li>
					))}
				</ul>
			)}

			<CopyMatches matches={matches} onRefresh={onRefresh} />
		</div>
	);
}

/** What the patterns match: detecting, a count with Refresh, the first matched paths, or a failure. */
function CopyMatches({ matches, onRefresh }: Pick<FilesToCopyFieldProps, "matches" | "onRefresh">) {
	return (
		<>
			{matches === null ? null : (
				<div className="flex items-center gap-1.5 text-xs text-fg-muted">
					{matches.state === "detecting" ? (
						<span role="status">Detecting files to copy...</span>
					) : matches.state === "error" ? (
						<span role="alert">Could not preview files to copy.</span>
					) : matches.paths.length === 0 ? (
						<span>No matching gitignored files found.</span>
					) : (
						<span>
							{matches.paths.length === 1
								? "1 file will be copied"
								: `${matches.paths.length} files will be copied`}
						</span>
					)}
					{onRefresh === undefined ? null : (
						<Button
							size="xs"
							variant="ghost"
							aria-label="Refresh files to copy preview"
							loading={matches.state === "detecting"}
							onClick={onRefresh}
						>
							Refresh
						</Button>
					)}
				</div>
			)}

			{matches?.state === "ready" && matches.paths.length > 0 ? (
				<MatchPreview paths={matches.paths} />
			) : null}
		</>
	);
}

function MatchPreview({ paths }: { paths: string[] }) {
	const shown = paths.slice(0, COPY_PREVIEW_LIMIT);
	return (
		<div className="flex flex-col gap-1">
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
