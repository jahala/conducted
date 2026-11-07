/**
 * @feature SET-07 Repository Misc page
 * @feature PRJ-05 Repository icon
 * Owns: the per-repository Misc page: the saved icon and its picker, locations, preview URLs, files
 * to copy into new workspaces, the branch new workspaces start from, and removing the repository.
 * Behaviour: ui-map.md 6, "Misc (repo)" table (Icon, Root path, Workspaces path, Preview URLs,
 * Files to copy, Remove repository) and "Git" table (rows with scope repository: branch new
 * workspaces from, remote origin). Files to copy is PRJ-04; the copy itself runs in the workspace
 * service.
 * Data: useRepos (path, icon, default branch), useRepoConfig (copyFiles, previewUrlTemplate,
 * remoteName), useWorkspaces (the count the removal dialog names), useSetting(conducted_root_path),
 * useActions().projects (updateConfig, remove).
 * Children: FilesToCopyField, RemoveRepoDialog.
 * Must handle: root path and workspaces path shown read-only with the warning not to move them; a
 * preview URL template validated with the workspace port variable; a remote name saved to the
 * personal settings file, with "origin" only as a placeholder; files to copy as patterns; and
 * removal that also removes workspaces (confirm with the count). The icon row shows the current
 * avatar and opens the Change repository icon picker (PRJ-05). Choosing a base other than the
 * default branch is WS-01.
 * Test first: removing a repository with two workspaces asks for confirmation naming the count.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useState } from "react";
import {
	useActions,
	useRepoConfig,
	useRepos,
	useSetting,
	useWorkspaces,
} from "../../../core/hooks.ts";
import type { RepoConfig } from "../../../core/model.ts";
import { expandPreviewUrl } from "../../../core/services/ports.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { RepoIconAvatar } from "../../sidebar/RepoIcon.tsx";
import { RepoIconPicker } from "../../sidebar/RepoIconPicker.tsx";
import { FilesToCopyField } from "./FilesToCopyField.tsx";
import { RemoveRepoDialog } from "./RemoveRepoDialog.tsx";

const SAMPLE_PORT = 55_000;

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

export function RepoMiscPage({ repoId }: { repoId: RepoId }) {
	const repos = useRepos();
	const config = useRepoConfig(repoId);
	const workspaces = useWorkspaces();
	const rootPath = useSetting<string>("conducted_root_path");
	const actions = useActions();
	const [remote, setRemote] = useState("");
	const [preview, setPreview] = useState("");
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [removing, setRemoving] = useState(false);
	const [iconOpen, setIconOpen] = useState(false);
	const readyConfig = config.state === "ready" ? config.data : null;

	useEffect(() => {
		if (readyConfig === null) return;
		// A repository with no remote_name uses "origin" when it creates a workspace. The field
		// shows the saved value only, so the invented default never looks like saved text.
		setRemote(readyConfig.remoteName ?? "");
		setPreview(readyConfig.previewUrlTemplate ?? "");
		setPreviewError(null);
	}, [readyConfig]);

	const save = async (next: RepoConfig): Promise<boolean> => {
		const saved = await actions.projects.updateConfig(repoId, next);
		if (!saved.ok) {
			toastError("Couldn't save the repository settings", saved.error);
			return false;
		}
		return true;
	};

	const saveRemote = () => {
		if (config.state !== "ready") return;
		const trimmed = remote.trim();
		const next = trimmed === "" ? null : trimmed;
		if (next === config.data.remoteName) return;
		void save({ ...config.data, remoteName: next });
	};

	const savePreview = () => {
		if (config.state !== "ready") return;
		const problem = previewUrlProblem(preview);
		setPreviewError(problem);
		if (problem !== null) return;
		const next = preview.trim() === "" ? null : preview.trim();
		if (next === config.data.previewUrlTemplate) return;
		void save({ ...config.data, previewUrlTemplate: next });
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
							errorTitle="Couldn't load the repository settings"
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

									<div className="flex flex-col gap-1.5 border-t border-border pt-4">
										<Label htmlFor="repo-branch-base">Branch new workspaces from</Label>
										<p className="text-sm text-fg-muted">
											New workspaces branch from the repository's default branch. Choosing another
											base is not built yet (WS-01).
										</p>
										<Input
											id="repo-branch-base"
											value={repoValue.defaultBranch}
											readOnly
											className="font-mono"
										/>
									</div>

									<div className="flex flex-col gap-1.5 border-t border-border pt-4">
										<Label htmlFor="repo-remote">Remote origin</Label>
										<p className="text-sm text-fg-muted">
											Where to push, pull and create pull requests.
										</p>
										<Input
											id="repo-remote"
											value={remote}
											placeholder="origin"
											className="w-64 font-mono"
											onChange={(event) => setRemote(event.target.value)}
											onBlur={saveRemote}
										/>
									</div>

									<div className="flex flex-col gap-1.5 border-t border-border pt-4">
										<Label htmlFor="repo-preview-url">Preview URLs</Label>
										<p className="text-sm text-fg-muted">
											The terminal panel's Open URLs. Use $CONDUCTED_PORT for the workspace port.
										</p>
										<Input
											id="repo-preview-url"
											value={preview}
											placeholder="http://localhost:$CONDUCTED_PORT"
											className="font-mono"
											error={previewError ?? undefined}
											onChange={(event) => {
												setPreview(event.target.value);
												setPreviewError(null);
											}}
											onBlur={savePreview}
										/>
									</div>

									<div className="flex flex-col gap-2 border-t border-border pt-4">
										<p className="text-sm font-medium text-fg">Files to copy</p>
										<p className="text-sm text-fg-muted">
											Conducted will automatically copy these file paths in each new workspace.
										</p>
										<FilesToCopyField
											patterns={settings.copyFiles}
											matches={null}
											onChange={(patterns) => void save({ ...settings, copyFiles: patterns })}
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
