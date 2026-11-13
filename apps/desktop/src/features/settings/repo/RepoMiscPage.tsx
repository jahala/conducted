/**
 * @feature SET-07 Repository Misc page
 * @feature PRJ-05 Repository icon
 * Owns: the per-repository Misc page: the saved icon and its picker, locations, preview URLs, files
 * to copy into new workspaces, and removing the repository.
 * Behaviour: ui-map.md 6, "Misc (repo)" table (Icon, Root path, Workspaces path, Preview URLs,
 * Files to copy, Remove repository); Conductor's misc tab (renderApp @11294974-11298000) with its
 * title and "Repository paths and workspace file behavior." The branch and the remote are on the
 * repository's Git page (repo/RepoGitPage.tsx), as Conductor has them. Files to copy is PRJ-04; the
 * copy itself runs in the workspace service.
 * Data: useRepos (path, icon), useRepoConfig (copyFiles, previewUrls), useWorkspaces (the
 * count the removal dialog names), useSetting(conductor_root_path), useActions().projects
 * (updateConfig, remove).
 * Children: FilesToCopyField, RemoveRepoDialog.
 * The Files to copy block shows Conductor's preview of the gitignored files the patterns match,
 * with its Refresh action (Actions.projects.copyPreview).
 * Must handle: root path and workspaces path shown read-only with the warning not to move them; an
 * ordered list of preview URL templates, each with an optional name and a URL validated with the
 * workspace port variable, saved 500 ms after the last edit, with add, remove and move up or down;
 * files to copy as patterns; and removal that also removes workspaces (confirm with the count).
 * A removed repository toasts "Repository removed successfully" and opens the user Git settings,
 * replacing the current history entry, as Conductor does (renderApp @11298112). The icon row shows
 * the current avatar and opens the Change repository icon picker (PRJ-05).
 * Test first: removing a repository with two workspaces asks for confirmation naming the count.
 */
import type { RepoId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	useActions,
	useRepoConfig,
	useRepos,
	useSetting,
	useWorkspaces,
} from "../../../core/hooks.ts";
import type { RepoConfigPatch } from "../../../core/model.ts";
import { expandPreviewUrl } from "../../../core/ports.ts";
import { previewUrlsToText } from "../../../core/registries/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { IconButton } from "../../../ui/IconButton.tsx";
import { Input } from "../../../ui/Input.tsx";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "../../../ui/icons.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { RepoIconAvatar } from "../../sidebar/RepoIcon.tsx";
import { RepoIconPicker } from "../../sidebar/RepoIconPicker.tsx";
import { toastSettingSaveFailed } from "../SettingRow.tsx";
import { FilesToCopyField } from "./FilesToCopyField.tsx";
import { RemoveRepoDialog } from "./RemoveRepoDialog.tsx";

const SAMPLE_PORT = 55_000;
/** Conductor waits this long after the last edit before saving a preview URL. */
const SAVE_DELAY_MS = 500;

interface PreviewRow {
	id: number;
	name: string;
	url: string;
	error: string | null;
}

function previewUrlProblem(template: string): string | null {
	const trimmed = template.trim();
	if (trimmed === "") return null;
	const expanded = expandPreviewUrl(trimmed, SAMPLE_PORT);
	if (!expanded.ok) return expanded.error.message;
	try {
		new URL(expanded.value);
		return null;
	} catch {
		return "Enter a URL such as http://localhost:$CONDUCTED_PORT.";
	}
}

function emptyRow(id: number): PreviewRow {
	return { id, name: "", url: "", error: null };
}

export function RepoMiscPage({ repoId }: { repoId: RepoId }) {
	const repos = useRepos();
	const config = useRepoConfig(repoId);
	const workspaces = useWorkspaces();
	const rootPath = useSetting<string>("conductor_root_path");
	const actions = useActions();
	const navigate = useNavigate();
	const nextRowId = useRef(0);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastSaved = useRef<string | null>(null);
	const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
	const [removing, setRemoving] = useState(false);
	const [iconOpen, setIconOpen] = useState(false);
	const [copyPreview, setCopyPreview] = useState<
		{ state: "detecting" } | { state: "ready"; paths: string[] } | { state: "error" } | null
	>(null);
	const readyConfig = config.state === "ready" ? config.data : null;

	/** Asks the repository which ignored files its copy patterns match (SET-07). */
	const refreshCopyPreview = useCallback(async (): Promise<void> => {
		setCopyPreview({ state: "detecting" });
		const result = await actions.projects.copyPreview(repoId);
		setCopyPreview(result.ok ? { state: "ready", paths: result.value } : { state: "error" });
	}, [actions, repoId]);

	const copyPatterns = readyConfig?.copyFiles.join("\n") ?? null;
	useEffect(() => {
		if (copyPatterns === null) return;
		void refreshCopyPreview();
	}, [copyPatterns, refreshCopyPreview]);

	useEffect(() => {
		if (readyConfig === null) return;
		const text = previewUrlsToText(readyConfig.previewUrls);
		// A config update that this page just wrote must not replace newer edits.
		if (lastSaved.current === text) return;
		lastSaved.current = text;
		const rows = readyConfig.previewUrls.map((entry) => ({
			id: nextRowId.current++,
			name: entry.name,
			url: entry.url,
			error: null,
		}));
		setPreviewRows(rows.length > 0 ? rows : [emptyRow(nextRowId.current++)]);
	}, [readyConfig]);

	useEffect(
		() => () => {
			if (saveTimer.current !== null) clearTimeout(saveTimer.current);
		},
		[],
	);

	const save = async (next: RepoConfigPatch): Promise<boolean> => {
		const saved = await actions.projects.updateConfig(repoId, next);
		if (!saved.ok) {
			toastSettingSaveFailed(saved.error, () =>
				actions.projects.updateConfig(repoId, next, { overwrite: true }),
			);
			return false;
		}
		return true;
	};

	/** Validates every row; saves the non-empty entries in the order shown when all are valid. */
	const savePreviewRows = (rows: PreviewRow[]): void => {
		const problems = rows.map((row) => previewUrlProblem(row.url));
		if (problems.some((problem) => problem !== null)) {
			setPreviewRows(rows.map((row, index) => ({ ...row, error: problems[index] ?? null })));
			return;
		}
		const entries = rows
			.map((row) => ({ name: row.name.trim(), url: row.url.trim() }))
			.filter((entry) => entry.url !== "");
		const text = previewUrlsToText(entries);
		if (text === lastSaved.current) return;
		const previous = lastSaved.current;
		lastSaved.current = text;
		void save({ previewUrls: entries }).then((saved) => {
			if (!saved) lastSaved.current = previous;
		});
	};

	/** Conductor saves 500 ms after the last edit, not when a field loses focus. */
	const schedulePreviewSave = (rows: PreviewRow[]): void => {
		if (saveTimer.current !== null) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			saveTimer.current = null;
			savePreviewRows(rows);
		}, SAVE_DELAY_MS);
	};

	const changePreviewRow = (id: number, field: "name" | "url", value: string): void => {
		const next = previewRows.map((row) =>
			row.id === id ? { ...row, [field]: value, error: null } : row,
		);
		setPreviewRows(next);
		schedulePreviewSave(next);
	};

	const blurPreviewRow = (): void => {
		const problems = previewRows.map((row) => previewUrlProblem(row.url));
		setPreviewRows(previewRows.map((row, index) => ({ ...row, error: problems[index] ?? null })));
	};

	const addPreviewRow = (): void => {
		const next = [...previewRows, emptyRow(nextRowId.current++)];
		setPreviewRows(next);
		schedulePreviewSave(next);
	};

	const removePreviewRow = (id: number): void => {
		const remaining = previewRows.filter((row) => row.id !== id);
		const next = remaining.length > 0 ? remaining : [emptyRow(nextRowId.current++)];
		setPreviewRows(next);
		schedulePreviewSave(next);
	};

	const movePreviewRow = (index: number, offset: number): void => {
		const target = index + offset;
		const current = previewRows[index];
		const other = previewRows[target];
		if (current === undefined || other === undefined) return;
		const next = [...previewRows];
		next[index] = other;
		next[target] = current;
		setPreviewRows(next);
		schedulePreviewSave(next);
	};

	const repoValue =
		repos.state === "ready" ? repos.data.find((entry) => entry.id === repoId) : undefined;
	const workspaceCount =
		workspaces.state === "ready"
			? workspaces.data.filter((workspace) => workspace.repoId === repoId).length
			: 0;

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">Misc</h1>
				<p className="text-sm text-fg-muted">Repository paths and workspace file behavior.</p>
			</div>

			<LoadableView
				value={repos}
				loadingLabel="Loading repositories"
				errorTitle="Couldn't load the repositories"
				loading={<Skeleton className="h-64 w-full" />}
			>
				{() =>
					repoValue === undefined ? (
						<EmptyState
							tone="failed"
							title="This repository no longer exists"
							body="It may have been removed in another window."
						/>
					) : (
						<LoadableView
							value={config}
							loadingLabel="Loading repository settings"
							errorTitle="Couldn't load repository settings. Try again."
							loading={
								<div className="flex flex-col gap-4">
									{[0, 1, 2].map((index) => (
										<Skeleton key={index} className="h-20 w-full" />
									))}
								</div>
							}
						>
							{(settings) => (
								<div className="flex flex-col gap-6">
									<div className="flex flex-col gap-2 border-t border-border pt-4">
										<p className="text-sm font-medium text-fg">Icon</p>
										<p className="text-sm text-fg-muted">
											Shown next to the repository name in the sidebar.
										</p>
										<div className="flex items-center gap-3">
											<RepoIconAvatar repo={repoValue} className="size-8 text-base" />
											<Button variant="outline" onClick={() => setIconOpen(true)}>
												Change repository icon
											</Button>
										</div>
										<RepoIconPicker open={iconOpen} onOpenChange={setIconOpen} repo={repoValue} />
									</div>

									<div className="flex flex-col gap-3 border-t border-border pt-4">
										<div>
											<p className="text-sm font-medium text-fg">Root path</p>
											<p className="text-sm text-fg-muted">
												Do not move or delete this directory. Instead, remove the repository in
												Conducted.
											</p>
											<p className="mt-1 break-all font-mono text-xs text-fg-muted">
												{repoValue.rootPath}
											</p>
										</div>
										<div>
											<p className="text-sm font-medium text-fg">Workspaces path</p>
											<p className="text-sm text-fg-muted">
												Do not move or delete the workspace subdirectories. Instead, archive
												workspaces in Conducted.
											</p>
											<p className="mt-1 break-all font-mono text-xs text-fg-muted">
												{`${rootPath.replace(/\/+$/, "")}/workspaces/${repoValue.name}`}
											</p>
										</div>
									</div>

									<div className="flex flex-col gap-3 border-t border-border pt-4">
										<div>
											<p className="text-sm font-medium text-fg">Preview URLs</p>
											<p className="text-sm text-fg-muted">
												The terminal panel's Open URLs. The first URL is the default; additional
												URLs appear in its menu. Use $CONDUCTED_PORT for the workspace port. Leave
												blank to detect a URL from output.
											</p>
										</div>
										<div className="flex flex-col gap-2">
											{previewRows.map((row, index) => (
												<div key={row.id} className="flex items-start gap-2">
													<Input
														aria-label={`Name ${index + 1}`}
														value={row.name}
														placeholder="Name"
														className="w-32 shrink-0 text-xs"
														autoCapitalize="off"
														autoCorrect="off"
														spellCheck={false}
														onChange={(event) =>
															changePreviewRow(row.id, "name", event.target.value)
														}
													/>
													<div className="min-w-0 flex-1">
														<Input
															aria-label={`Preview URL ${index + 1}`}
															value={row.url}
															placeholder="http://localhost:$CONDUCTED_PORT"
															className="font-mono text-xs"
															autoCapitalize="off"
															autoCorrect="off"
															spellCheck={false}
															error={row.error ?? undefined}
															onChange={(event) =>
																changePreviewRow(row.id, "url", event.target.value)
															}
															onBlur={blurPreviewRow}
														/>
													</div>
													{previewRows.length > 1 ? (
														<div className="flex shrink-0 flex-col">
															<IconButton
																label="Move preview URL up"
																size="xs"
																icon={<ArrowUpIcon className="size-3" />}
																disabled={index === 0}
																onClick={() => movePreviewRow(index, -1)}
															/>
															<IconButton
																label="Move preview URL down"
																size="xs"
																icon={<ArrowDownIcon className="size-3" />}
																disabled={index === previewRows.length - 1}
																onClick={() => movePreviewRow(index, 1)}
															/>
														</div>
													) : null}
													<IconButton
														label="Remove preview URL"
														size="sm"
														icon={<TrashIcon className="size-3.5" />}
														disabled={
															previewRows.length === 1 &&
															row.name.trim() === "" &&
															row.url.trim() === ""
														}
														onClick={() => removePreviewRow(row.id)}
													/>
												</div>
											))}
										</div>
										<div>
											<Button variant="outline" size="sm" onClick={addPreviewRow}>
												<PlusIcon className="size-3" />
												Add preview URL
											</Button>
										</div>
									</div>

									<div className="flex flex-col gap-2 border-t border-border pt-4">
										<p className="text-sm font-medium text-fg">Files to copy</p>
										<p className="text-sm text-fg-muted">
											Conducted will automatically copy these file paths in each new workspace.
										</p>
										<FilesToCopyField
											patterns={settings.copyFiles}
											matches={copyPreview}
											onChange={(patterns) => void save({ copyFiles: patterns })}
											onRefresh={() => void refreshCopyPreview()}
										/>
									</div>

									<div className="flex items-center justify-between gap-4 border-t border-border pt-4">
										<div>
											<p className="text-sm font-medium text-fg">Remove repository</p>
											<p className="text-sm text-fg-muted">
												Remove this repository and its workspaces from Conducted.
											</p>
										</div>
										<Button variant="outlineDestructive" onClick={() => setRemoving(true)}>
											Remove repository
										</Button>
									</div>

									<RemoveRepoDialog
										open={removing}
										repoName={repoValue.name}
										workspaceCount={workspaceCount}
										runningAgentCount={0}
										onOpenChange={setRemoving}
										onConfirm={async () => {
											const removed = await actions.projects.remove(repoId);
											if (!removed.ok) {
												toastError("Couldn't remove the repository", removed.error);
												return false;
											}
											toast.success("Repository removed successfully");
											void navigate({
												to: "/settings/user/$page",
												params: { page: "git" },
												replace: true,
											});
											return true;
										}}
									/>
								</div>
							)}
						</LoadableView>
					)
				}
			</LoadableView>
		</div>
	);
}
