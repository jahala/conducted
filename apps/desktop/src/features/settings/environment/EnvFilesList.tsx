/**
 * @feature SET-04 Environment files list
 * Owns: the list of dotenv files in the repository that hold more variables.
 * Behaviour: ui-map.md 6, "Environment page" (env files list, "Cancel adding env file");
 * services-map.md 4.2.3 (environment_variable_files).
 * Must handle: no files, a file that does not exist (marked), a file the app may not check (marked
 * with the reason, never as not found, issue #601), a path outside the repository
 * (refused), adding by picking from a list of dotenv-style files found in the repository or with
 * the system file picker (its title is "Select env file" and the Browse button explains Cmd+Shift+.),
 * and removing an entry without touching the file. The dotenv reader itself is core/services/dotenv,
 * because the launch reads the same files (SET-04).
 * Test first: adding a path outside the repository root is refused.
 */
import type { Result } from "@conducted/shared";
import { useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { FolderIcon } from "../../../ui/icons.tsx";

/** Collapses `.` and `..` by spelling, so a path cannot leave the repository it was given. */
const normalize = (path: string): string => {
	const absolute = path.startsWith("/");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `${absolute ? "/" : ""}${parts.join("/")}`;
};

/** The path inside `root`, or null when it is empty or points outside the repository. */
export function pathInsideRepository(root: string, path: string): string | null {
	const value = path.trim();
	if (value === "") return null;
	const base = normalize(root);
	const resolved = normalize(value.startsWith("/") ? value : `${base}/${value}`);
	if (resolved === base) return null;
	return resolved.startsWith(`${base}/`) ? resolved.slice(base.length + 1) : null;
}

export interface EnvFilesListProps {
	/** Each file with whether it is on disk; an Err is a check the app could not make. */
	files: { path: string; exists: Result<boolean> }[];
	candidates: string[];
	/** Every path must stay inside this folder. Without it, only a candidate can be added. */
	repositoryRoot?: string;
	onAdd: (path: string) => Promise<boolean>;
	onRemove: (path: string) => Promise<boolean>;
	/** Opens the system file picker with Conductor's title. Null when the user cancels. */
	onBrowse?: () => Promise<string | null>;
}

export function EnvFilesList({
	files,
	candidates,
	repositoryRoot,
	onAdd,
	onRemove,
	onBrowse,
}: EnvFilesListProps) {
	const [adding, setAdding] = useState(false);
	const [path, setPath] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const add = async () => {
		const candidate = path.trim();
		if (candidate === "") {
			setError("Choose a dotenv file to add.");
			return;
		}
		if (repositoryRoot === undefined) {
			if (!candidates.includes(candidate)) {
				setError("Choose one of the dotenv files found in this repository.");
				return;
			}
		} else if (pathInsideRepository(repositoryRoot, candidate) === null) {
			setError("Choose a file inside the repository.");
			return;
		}
		setSaving(true);
		const saved = await onAdd(candidate);
		setSaving(false);
		if (!saved) {
			setError("Couldn't add the file.");
			return;
		}
		setPath("");
		setError(null);
		setAdding(false);
	};

	return (
		<div className="flex flex-col gap-2">
			{files.length === 0 ? (
				<p className="text-sm text-fg-muted">No environment files yet.</p>
			) : (
				<ul className="flex flex-col">
					{files.map((file) => (
						<li
							key={file.path}
							className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm"
						>
							<div className="flex min-w-0 items-center gap-2">
								<span className="truncate font-mono text-code text-fg">{file.path}</span>
								{file.exists.ok ? (
									file.exists.value ? null : (
										<span className="text-xs text-danger">File not found</span>
									)
								) : (
									<span className="text-xs text-danger">{file.exists.error.message}</span>
								)}
							</div>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => void onRemove(file.path)}
								aria-label={`Remove ${file.path}`}
							>
								Remove
							</Button>
						</li>
					))}
				</ul>
			)}
			{adding ? (
				<div className="flex flex-col gap-2">
					<div className="flex items-end gap-2">
						<div className="relative flex-1">
							<Input
								aria-label="Environment file path"
								placeholder={repositoryRoot === undefined ? "~/.env" : ".env"}
								list="environment-file-candidates"
								value={path}
								autoCapitalize="off"
								spellCheck={false}
								className="pr-8 font-mono"
								onChange={(event) => setPath(event.target.value)}
							/>
							{onBrowse === undefined ? null : (
								<Button
									variant="ghost"
									size="xs"
									className="absolute top-1/2 right-1 -translate-y-1/2"
									title="Browse for env file. Press Cmd+Shift+. to show hidden files."
									aria-label="Browse for env file"
									onClick={() => {
										void onBrowse().then((picked) => {
											if (picked === null) return;
											setPath(picked);
											setError(null);
										});
									}}
								>
									<FolderIcon className="size-3.5" />
								</Button>
							)}
						</div>
						<datalist id="environment-file-candidates">
							{candidates.map((candidate) => (
								<option key={candidate} value={candidate} />
							))}
						</datalist>
						<Button size="sm" loading={saving} onClick={() => void add()}>
							Add
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setAdding(false);
								setPath("");
								setError(null);
							}}
						>
							Cancel adding env file
						</Button>
					</div>
					{error === null ? null : (
						<p role="alert" className="text-xs text-danger">
							{error}
						</p>
					)}
				</div>
			) : (
				<div>
					<Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
						Add env file
					</Button>
				</div>
			)}
		</div>
	);
}
