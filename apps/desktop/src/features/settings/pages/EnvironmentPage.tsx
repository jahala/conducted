/**
 * @feature SET-04 Environment settings page
 * Owns: the Environment page of Settings: environment variables given to agents, setup scripts and
 * actions, and the files that hold more variables. Interactive terminals do not receive them.
 * Behaviour: ui-map.md 6, "Environment" table and "Environment page" (Variables table: Name,
 * Value, "Locally overwritten", "Not set"; empty state "No variables set"; env files list; a
 * banner for importing local variables); services-map.md 4.2.8 (env_vars table; values are secrets).
 * Data: useEnvVars(scope), useActions().settings.setEnvVar and removeEnvVar, useSetting for the
 * dismissed banner. The environment file list belongs to the scope: "All repositories" reads and
 * writes the user's list (useSetting, Actions.settings.set); a repository reads the list that applies
 * to it (SettingsService.getForRepo) and writes its own local settings file (setForRepo). When the
 * repository's own file holds the list, "Reset to shared settings" removes it there
 * (Actions.settings.resetForRepo, SET-02), so the shared settings.toml or the user's list applies.
 * Children: environment/EnvVarTable, environment/AddEnvVarForm, environment/EnvFilesList.
 * Our design choice: values live in the Keychain; the database holds names only (SET-04). The page
 * has a scope switch: all repositories, or one repository whose values override the global ones.
 * Must handle: no variables (designed empty state), a name that is invalid or reserved (names of
 * variables the app sets itself are refused), a value hidden until revealed, a Keychain error (a
 * short message, nothing is lost), an overridden variable (shows which scope wins), an import where
 * some variables fail (each failure named, the banner stays), and values never written to logs.
 * Test first: adding a variable calls setEnvVar with the scope and shows the row with a hidden
 * value.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useMemo, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useEnvVars, useRepos, useSetting } from "../../../core/hooks.ts";
import type { EnvScope } from "../../../core/model.ts";
import {
	ENV_FILES_FAILED_MESSAGE,
	ENV_SAVE_FAILED_MESSAGE,
	RESERVED_ENV_VAR_NAMES,
} from "../../../core/services/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Select } from "../../../ui/Select.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { AddEnvVarForm } from "../environment/AddEnvVarForm.tsx";
import { EnvFilesList, parseDotenv, pathInsideRepository } from "../environment/EnvFilesList.tsx";
import { EnvVarTable } from "../environment/EnvVarTable.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

const ENV_FILES_KEY = "environment_variable_files";
const BANNER_DISMISSED_KEY = "local_env_vars_import_banner_dismissed";

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function EnvironmentPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const repos = useRepos();
	const actions = useActions();
	const services = useServices().services;
	const { platform } = useServices();
	const [repoChoice, setRepoChoice] = useState<string | null>(null);
	const [files, setFiles] = useState<{ path: string; exists: boolean }[]>([]);
	const [candidates, setCandidates] = useState<string[]>([]);
	const [importing, setImporting] = useState(false);
	const [repoFiles, setRepoFiles] = useState<{
		root: string;
		paths: string[];
		/** The repository's own local settings file holds the list, so it can be reset. */
		ownValue: boolean;
	} | null>(null);
	// Bumped after a reset, so the repository's list is read again from its layers.
	const [repoFilesVersion, setRepoFilesVersion] = useState(0);

	const repoList = repos.state === "ready" ? repos.data : [];
	const selectedRepo = repoList.find((repo) => repo.id === repoChoice) ?? null;
	const scope = useMemo<EnvScope>(
		() => (repoChoice === null ? "global" : { repoId: repoChoice as RepoId }),
		[repoChoice],
	);
	const scopeValue = repoChoice ?? "all";
	const vars = useEnvVars(scope);
	const userFiles = useSetting<string[]>(ENV_FILES_KEY);
	const repoRoot = selectedRepo?.rootPath ?? null;
	const storedFiles =
		repoRoot === null ? userFiles : repoFiles?.root === repoRoot ? repoFiles.paths : [];
	const filesKey = storedFiles.join("\n");
	const bannerDismissed = useSetting<boolean>(BANNER_DISMISSED_KEY);
	const root = selectedRepo?.rootPath ?? platform.fs.paths.home;

	const existingNames = vars.state === "ready" ? vars.data.map((row) => row.name) : [];

	// A repository's list: its own local file, else the layers above it. Only the newest read is kept.
	// biome-ignore lint/correctness/useExhaustiveDependencies: a reset bumps repoFilesVersion so the list is read again.
	useEffect(() => {
		if (repoRoot === null) return;
		let cancelled = false;
		const read = async () => {
			const resolved = await services.settings.getForRepo(ENV_FILES_KEY, repoRoot, null);
			if (cancelled) return;
			if (!resolved.ok) {
				toastError(ENV_FILES_FAILED_MESSAGE, resolved.error);
				return;
			}
			const value = resolved.value.value;
			const paths = Array.isArray(value)
				? value.filter((entry): entry is string => typeof entry === "string")
				: [];
			setRepoFiles({
				root: repoRoot,
				paths,
				ownValue: resolved.value.source === "repo-local",
			});
		};
		void read();
		return () => {
			cancelled = true;
		};
	}, [repoRoot, services.settings, repoFilesVersion]);

	useEffect(() => {
		let cancelled = false;
		const scan = async () => {
			const listed = await platform.fs.readDir(root);
			if (cancelled) return;
			if (!listed.ok) {
				setCandidates([]);
				return;
			}
			setCandidates(
				listed.value
					.filter((entry) => !entry.isDirectory && /^\.env(\..+)?$/.test(baseName(entry.path)))
					.map((entry) => baseName(entry.path))
					.sort((left, right) => left.localeCompare(right)),
			);
		};
		void scan();
		return () => {
			cancelled = true;
		};
	}, [platform.fs, root]);

	useEffect(() => {
		let cancelled = false;
		const paths = filesKey === "" ? [] : filesKey.split("\n");
		const check = async () => {
			const checked = await Promise.all(
				paths.map(async (path) => {
					const inside = pathInsideRepository(root, path);
					const absolute = inside === null ? path : `${root}/${inside}`;
					return { path, exists: await platform.fs.exists(absolute) };
				}),
			);
			if (!cancelled) setFiles(checked);
		};
		void check();
		return () => {
			cancelled = true;
		};
	}, [filesKey, root, platform.fs]);

	/** Writes the list of the selected scope: the user's, or the repository's own local file. */
	const saveFiles = async (next: string[]): Promise<boolean> => {
		const saved =
			repoRoot === null
				? await actions.settings.set(ENV_FILES_KEY, next)
				: await services.settings.setForRepo(repoRoot, ENV_FILES_KEY, next);
		if (!saved.ok) {
			toastError(ENV_FILES_FAILED_MESSAGE, saved.error);
			return false;
		}
		// The repository's own file is the top layer, so what was written is now its list.
		if (repoRoot !== null) setRepoFiles({ root: repoRoot, paths: next, ownValue: true });
		return true;
	};

	/** Drops the repository's own list, so its shared settings (or the user's list) apply again. */
	const resetFiles = async (): Promise<void> => {
		if (selectedRepo === null) return;
		const reset = await actions.settings.resetForRepo(selectedRepo.id, ENV_FILES_KEY);
		if (!reset.ok) {
			toastError(ENV_FILES_FAILED_MESSAGE, reset.error);
			return;
		}
		setRepoFilesVersion((version) => version + 1);
	};

	const addFile = async (path: string): Promise<boolean> => {
		if (storedFiles.includes(path)) {
			toast("That environment file is already in the list.");
			return true;
		}
		return saveFiles([...storedFiles, path]);
	};

	const removeFile = async (path: string): Promise<boolean> => {
		const removed = await saveFiles(storedFiles.filter((entry) => entry !== path));
		if (removed) toast("Environment file removed");
		return removed;
	};

	const addVariable = async (name: string, value: string): Promise<boolean> => {
		const saved = await actions.settings.setEnvVar(name, value, scope);
		if (!saved.ok) {
			toastError(ENV_SAVE_FAILED_MESSAGE, saved.error);
			return false;
		}
		toast(`${name} saved`);
		return true;
	};

	const editVariable = async (name: string, value: string): Promise<boolean> => {
		const saved = await actions.settings.setEnvVar(name, value, scope);
		if (!saved.ok) {
			toastError(ENV_SAVE_FAILED_MESSAGE, saved.error);
			return false;
		}
		return true;
	};

	const removeVariable = async (name: string): Promise<boolean> => {
		const removed = await actions.settings.removeEnvVar(name, scope);
		if (!removed.ok) {
			toastError(ENV_SAVE_FAILED_MESSAGE, removed.error);
			return false;
		}
		return true;
	};

	const importCandidate =
		storedFiles.find((path) => path.trim() !== "") ??
		(candidates.includes(".env") ? ".env" : candidates[0]);

	const importLocal = async () => {
		const candidate = importCandidate;
		if (candidate === undefined) {
			toast("No dotenv file was found to import.");
			return;
		}
		const inside = pathInsideRepository(root, candidate);
		if (inside === null) {
			toastError(ENV_SAVE_FAILED_MESSAGE, {
				message: "That file is outside the repository.",
			});
			return;
		}
		setImporting(true);
		const text = await platform.fs.readText(`${root}/${inside}`);
		if (!text.ok) {
			setImporting(false);
			toastError("Couldn't read the environment file", text.error);
			return;
		}
		let imported = 0;
		const failed: { name: string; message: string }[] = [];
		for (const pair of parseDotenv(text.value)) {
			if (existingNames.includes(pair.name)) continue;
			const saved = await actions.settings.setEnvVar(pair.name, pair.value, scope);
			if (saved.ok) imported += 1;
			else failed.push({ name: pair.name, message: saved.error.message });
		}
		setImporting(false);
		// A failed variable keeps the banner, so the user can fix the file and import again.
		if (failed.length > 0) {
			toastError(
				`Imported ${imported} of ${imported + failed.length} variables`,
				{ message: failed.map((entry) => `${entry.name}: ${entry.message}`).join(" ") },
				{ duration: Number.POSITIVE_INFINITY },
			);
			return;
		}
		const dismissed = await actions.settings.set(BANNER_DISMISSED_KEY, true);
		if (!dismissed.ok) toastError("Couldn't dismiss the import banner", dismissed.error);
		toast(
			imported === 0
				? "No new variables were found in the environment file."
				: `Imported ${imported} ${imported === 1 ? "variable" : "variables"}`,
		);
	};

	const revealVariable = async (name: string): Promise<string | null> => {
		const read = await services.settings.revealEnvVar(name, scope);
		if (!read.ok) {
			toastError("Couldn't read the value from the Keychain", read.error);
			return null;
		}
		return read.value;
	};

	const dismissBanner = async () => {
		const saved = await actions.settings.set(BANNER_DISMISSED_KEY, true);
		if (!saved.ok) toastError("Couldn't dismiss the import banner", saved.error);
	};

	const showBanner = !bannerDismissed && importCandidate !== undefined;

	return (
		<SettingsPageFrame
			title="Environment"
			description="Variables given to agents, setup scripts and actions. Values stay in the macOS Keychain."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<div className="flex flex-col gap-6">
				<div className="flex items-center justify-between gap-4">
					<div>
						<p className="text-sm font-medium text-fg">Scope</p>
						<p className="text-sm text-fg-muted">
							Variables for every repository, or only for one where they win over the shared value.
						</p>
					</div>
					<Select
						aria-label="Scope"
						value={scopeValue}
						options={[
							{ value: "all", label: "All repositories" },
							...repoList.map((repo) => ({ value: repo.id, label: repo.name })),
						]}
						onValueChange={(next) => setRepoChoice(next === "all" ? null : next)}
					/>
				</div>

				{showBanner ? (
					<div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted p-4">
						<div>
							<p className="text-sm font-medium text-fg">Import local variables</p>
							<p className="text-sm text-fg-muted">
								Add the names and values from {importCandidate} to this scope. The values go to the
								Keychain.
							</p>
						</div>
						<div className="flex shrink-0 gap-2">
							<Button variant="secondary" loading={importing} onClick={() => void importLocal()}>
								Import
							</Button>
							<Button variant="ghost" onClick={() => void dismissBanner()}>
								Dismiss
							</Button>
						</div>
					</div>
				) : null}

				<div className="flex flex-col gap-3 border-t border-border pt-4">
					<div>
						<h2 className="text-base font-medium text-fg">Variables</h2>
						<p className="text-sm text-fg-muted">
							Names are stored in the app; values are stored in the macOS Keychain.
						</p>
					</div>
					<LoadableView
						value={vars}
						loadingLabel="Loading environment variables"
						errorTitle="Couldn't load the environment variables"
						loading={<p className="text-sm text-fg-muted">Loading environment variables…</p>}
						onRetry={() => void services.settings.loadEnvVars(scope)}
					>
						{(rows) => (
							<EnvVarTable
								vars={rows}
								onReveal={revealVariable}
								onEdit={editVariable}
								onRemove={removeVariable}
							/>
						)}
					</LoadableView>
					<AddEnvVarForm
						existingNames={existingNames}
						reservedNames={RESERVED_ENV_VAR_NAMES}
						onAdd={addVariable}
					/>
				</div>

				<div className="flex flex-col gap-3 border-t border-border pt-4">
					<div>
						<h2 className="text-base font-medium text-fg">Environment files</h2>
						<p className="text-sm text-fg-muted">
							Dotenv files found in {selectedRepo === null ? "your home folder" : selectedRepo.name}
							. A path is listed here and its names can be imported into the variables above.
						</p>
						{repoRoot !== null && repoFiles?.root === repoRoot && repoFiles.ownValue ? (
							<Button variant="link" size="sm" onClick={() => void resetFiles()}>
								Reset to shared settings
							</Button>
						) : null}
					</div>
					<EnvFilesList
						files={files}
						candidates={candidates}
						repositoryRoot={root}
						onAdd={addFile}
						onRemove={removeFile}
					/>
				</div>
			</div>
		</SettingsPageFrame>
	);
}
