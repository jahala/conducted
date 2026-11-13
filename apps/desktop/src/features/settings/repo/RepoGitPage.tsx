/**
 * @feature SET-07 Repository Git page
 * Owns: a repository's Git section of Settings: the branch new workspaces start from, the remote
 * to push to, and this repository's own value of the git settings a repository may change.
 * Behaviour: Conductor's git tab in the workspace scope (renderApp the git registry
 * @11134672-11143209, rows with scope workspace): "Branch new workspaces from" ("Each workspace is an
 * isolated copy of your codebase."), "Remote origin", then "Delete branch on archive", "Archive on
 * merge" and "Set upstream on plain git push", each showing the value that applies to this
 * repository and writing this repository's local settings file. ui-map.md 6, "Git" table (rows with
 * scope repo).
 * Data: useRepos (path, default branch), useRepoConfig (remoteName), useBranches (the branch list
 * the popover shows), SettingsService.getForRepo and setForRepo for the repository's own values,
 * useActions().settings.resetForRepo and useActions().projects (updateConfig, setDefaultBranch).
 * Must handle: loading and a removed repository, a remote name saved to the personal settings file
 * with "origin" only as a placeholder, a branch list read only while the popover is open, a
 * repository value that differs from the user's (Reset to shared settings removes it, so the
 * shared settings.toml or the user's value applies again), a save or reset that fails (a toast says
 * so with Conductor's words, and the switch shows the stored value), only the newest read changing
 * a row, and a value still loading (the switch shows the setting's default and cannot be changed,
 * as Conductor's row does, renderApp @11165946; issue #615).
 * Test first: turning on Delete branch on archive writes this repository's value and leaves the
 * user's value alone.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useBranches, useRepoConfig, useRepos } from "../../../core/hooks.ts";
import { getSettingDef, pageDescriptionOf } from "../../../core/registries/settings.ts";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Input } from "../../../ui/Input.tsx";
import { ChevronDownIcon } from "../../../ui/icons.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Popover } from "../../../ui/Popover.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { TargetBranchPicker } from "../../git-panel/changes/TargetBranchPicker.tsx";
import { SettingRow, toastSettingSaveFailed } from "../SettingRow.tsx";

/** Conductor's git rows a repository may set for itself, in its order. */
const REPO_SWITCHES = [
	"delete_branch_on_archive",
	"archive_on_merge",
	"worktree_push_auto_setup_remote",
] as const;

/** The repository's local branches, read only while the branch popover is open. */
function RepoBranchList({
	repoId,
	current,
	onSelect,
}: {
	repoId: RepoId;
	current: string;
	onSelect: (branch: string) => void;
}) {
	const branches = useBranches(repoId);
	return (
		<TargetBranchPicker
			branches={branches.state === "ready" ? branches.data : []}
			current={current}
			onSelect={onSelect}
			loading={branches.state === "loading"}
			error={branches.state === "error" ? branches.error.message : null}
		/>
	);
}

/** One git switch as it applies to this repository, written to the repository's own file. */
function RepoSwitchRow({
	repoId,
	rootPath,
	settingKey,
}: {
	repoId: RepoId;
	rootPath: string;
	settingKey: string;
}) {
	const { services } = useServices();
	const actions = useActions();
	const def = getSettingDef(settingKey);
	const [resolved, setResolved] = useState<{ value: boolean; own: boolean } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [version, setVersion] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a write bumps `version` so the value is read again.
	useEffect(() => {
		let current = true;
		const read = async () => {
			const found = await services.settings.getForRepo(settingKey, rootPath, null);
			if (!current) return;
			if (!found.ok) {
				setError(found.error.message);
				return;
			}
			setResolved({ value: found.value.value === true, own: found.value.source === "repo-local" });
		};
		void read();
		return () => {
			current = false;
		};
	}, [services.settings, settingKey, rootPath, version]);

	if (def === undefined) return null;

	const change = async (next: boolean) => {
		setError(null);
		const saved = await services.settings.setForRepo(rootPath, settingKey, next);
		if (!saved.ok) {
			toastSettingSaveFailed(saved.error, async () => {
				const forced = await services.settings.setForRepo(rootPath, settingKey, next, {
					overwrite: true,
				});
				setVersion((value) => value + 1);
				return forced;
			});
		}
		setVersion((value) => value + 1);
	};

	const reset = async () => {
		setError(null);
		const done = await actions.settings.resetForRepo(repoId, settingKey);
		if (!done.ok) {
			toastSettingSaveFailed(done.error, async () => {
				const forced = await actions.settings.resetForRepo(repoId, settingKey, {
					overwrite: true,
				});
				setVersion((value) => value + 1);
				return forced;
			});
		}
		setVersion((value) => value + 1);
	};

	return (
		<SettingRow
			settingKey={settingKey}
			title={def.title}
			description={pageDescriptionOf(def)}
			disabledReason={null}
			highlighted={false}
			saveError={error}
			onReset={resolved?.own === true ? () => void reset() : undefined}
		>
			<Switch
				aria-label={def.title}
				checked={resolved?.value ?? def.default === true}
				disabled={resolved === null}
				onCheckedChange={(checked) => void change(checked)}
			/>
		</SettingRow>
	);
}

export function RepoGitPage({ repoId }: { repoId: RepoId }) {
	const repos = useRepos();
	const config = useRepoConfig(repoId);
	const actions = useActions();
	const [remote, setRemote] = useState("");
	const [branchOpen, setBranchOpen] = useState(false);
	const readyConfig = config.state === "ready" ? config.data : null;

	// The stored remote, once the config has loaded. Reading the config again makes a new object
	// with the same values (any save on this page does it), so the field follows the stored value,
	// not the object: text being typed stays until it is saved (issue #658).
	const storedRemote = readyConfig === null ? undefined : (readyConfig.remoteName ?? "");
	useEffect(() => {
		if (storedRemote === undefined) return;
		// A repository with no remote_name uses "origin" when it creates a workspace. The field
		// shows the saved value only, so the invented default never looks like saved text.
		setRemote(storedRemote);
	}, [storedRemote]);

	const repoValue =
		repos.state === "ready" ? repos.data.find((entry) => entry.id === repoId) : undefined;

	const saveRemote = async () => {
		if (config.state !== "ready") return;
		const trimmed = remote.trim();
		const next = trimmed === "" ? null : trimmed;
		if (next === config.data.remoteName) return;
		const saved = await actions.projects.updateConfig(repoId, { remoteName: next });
		if (!saved.ok) toastError("Couldn't save the repository settings", saved.error);
	};

	const saveDefaultBranch = async (branch: string): Promise<void> => {
		setBranchOpen(false);
		if (repoValue === undefined || branch === repoValue.defaultBranch) return;
		const saved = await actions.projects.setDefaultBranch(repoId, branch);
		if (!saved.ok) toastError("Couldn't save the default branch", saved.error);
	};

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-medium text-fg">Git</h1>

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
						<div className="flex flex-col">
							<SettingRow
								settingKey="repo_default_branch"
								title="Branch new workspaces from"
								description="Each workspace is an isolated copy of your codebase."
								disabledReason={null}
								highlighted={false}
								saveError={null}
							>
								<Popover
									open={branchOpen}
									onOpenChange={setBranchOpen}
									align="end"
									trigger={
										<button
											type="button"
											aria-label="Branch new workspaces from"
											className="flex h-8 w-48 items-center justify-between gap-2 rounded-md border border-border-strong px-2 text-left text-sm text-fg hover:bg-hover"
										>
											<span className="truncate font-mono text-xs">{repoValue.defaultBranch}</span>
											<ChevronDownIcon className="size-3 shrink-0 text-fg-muted" />
										</button>
									}
								>
									{branchOpen ? (
										<RepoBranchList
											repoId={repoId}
											current={repoValue.defaultBranch}
											onSelect={(branch) => void saveDefaultBranch(branch)}
										/>
									) : null}
								</Popover>
							</SettingRow>
							<SettingRow
								settingKey="remote_name"
								title="Remote origin"
								description="Where should we push, pull, and create PRs?"
								disabledReason={null}
								highlighted={false}
								saveError={null}
							>
								<Input
									aria-label="Remote origin"
									value={remote}
									placeholder="origin"
									className="w-48 font-mono"
									disabled={config.state !== "ready"}
									onChange={(event) => setRemote(event.target.value)}
									onBlur={() => void saveRemote()}
								/>
							</SettingRow>
							{REPO_SWITCHES.map((key) => (
								<RepoSwitchRow
									key={key}
									repoId={repoId}
									rootPath={repoValue.rootPath}
									settingKey={key}
								/>
							))}
						</div>
					)
				}
			</LoadableView>
		</div>
	);
}
