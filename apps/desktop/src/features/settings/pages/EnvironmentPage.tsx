/**
 * @feature SET-04 Environment settings page
 * @feature SET-11 Documented variables on the Environment page
 * Owns: the Environment page of Settings, for every repository or for one: environment variables
 * given to agents, setup scripts and actions, and the files that hold more variables. Interactive
 * terminals do not receive them. The files are read again when a script or an agent starts
 * (SettingsService.environmentForLaunch); their values never reach a log line.
 * Behaviour: Conductor's Environment page (renderApp LDa and PDa @10716400-10719700): the title,
 * "Configure environment variables used by Conducted and passed to agents.", and "Add environment
 * variable" at the title's right, which opens the add panel; then the scope's own variables as
 * Conductor's table with the documented ones behind their link. A repository's page (its
 * Environment section, SET-07) adds "Inherited from User": every variable of all repositories, read
 * only, dimmed where this repository replaces it. Then the env files. services-map.md 4.2.8
 * (env_vars table; values are secrets).
 * Data: useEnvVars(scope) (and useEnvVars("global") for the inherited table),
 * useActions().settings.setEnvVar and removeEnvVar, Actions.app.copyText, useSetting for the
 * dismissed banner. The environment file list belongs to the scope: all repositories read and
 * write the user's list (useSetting, Actions.settings.set); a repository reads the list that
 * applies to it (SettingsService.getForRepo) and writes its own local settings file (setForRepo).
 * When the repository's own file holds the list, "Reset to shared settings" removes it there
 * (Actions.settings.resetForRepo, SET-02), so the shared settings.toml or the user's list applies.
 * Children: environment/EnvVarTable, environment/AddEnvVarForm, environment/EnvFilesList.
 * Our design choice: values live in the Keychain; the database holds names only (SET-04). The
 * banner that imports a dotenv file into the variables is ours: our env files are a list to import
 * from, where Conductor's load their variables when an agent starts.
 * Must handle: no variables (designed empty state), a name that is invalid or reserved (names of
 * variables the app sets itself are refused), a value hidden until revealed, a Keychain error (a
 * short message, nothing is lost), a rename (the new name is saved before the old one goes), an
 * overridden variable (dimmed in the inherited table), an import where some variables fail (each
 * failure named, the banner stays), and values never written to logs.
 * Test first: adding a variable from the panel saves it in the scope and shows the row with a
 * hidden value.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useMemo, useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useEnvVars, useRepos, useSetting } from "../../../core/hooks.ts";
import type { EnvScope, EnvVarView } from "../../../core/model.ts";
import { parseDotenv } from "../../../core/services/dotenv.ts";
import {
	ENV_FILES_FAILED_MESSAGE,
	ENV_SAVE_FAILED_MESSAGE,
} from "../../../core/services/settings.ts";
import { Button } from "../../../ui/Button.tsx";
import { PlusIcon } from "../../../ui/icons.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { AddEnvVarForm, type EnvDraft } from "../environment/AddEnvVarForm.tsx";
import { EnvFilesList, pathInsideRepository } from "../environment/EnvFilesList.tsx";
import {
	documentedMeaning,
	orderSetNames,
	unsetDocumentedEnvVars,
} from "../environment/EnvVarSuggestions.tsx";
import { type EnvTableRow, EnvVarTable } from "../environment/EnvVarTable.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

const ENV_FILES_KEY = "environment_variable_files";
const BANNER_DISMISSED_KEY = "local_env_vars_import_banner_dismissed";

const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

export function EnvironmentPage({
	focusSettingKey = null,
	repoId = null,
}: {
	focusSettingKey?: string | null;
	/** A repository's Environment section; null is the page for every repository. */
	repoId?: RepoId | null;
}) {
	const load = useSettingsLoad();
	const repos = useRepos();
	const actions = useActions();
	const services = useServices().services;
	const { platform } = useServices();
	const [adding, setAdding] = useState(false);
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
	const selectedRepo = repoList.find((repo) => repo.id === repoId) ?? null;
	const scope = useMemo<EnvScope>(() => (repoId === null ? "global" : { repoId }), [repoId]);
	const vars = useEnvVars(scope);
	const userVars = useEnvVars("global");
	const userFiles = useSetting<string[]>(ENV_FILES_KEY);
	const repoRoot = selectedRepo?.rootPath ?? null;
	const storedFiles =
		repoRoot === null ? userFiles : repoFiles?.root === repoRoot ? repoFiles.paths : [];
	const filesKey = storedFiles.join("\n");
	const bannerDismissed = useSetting<boolean>(BANNER_DISMISSED_KEY);
	const root = selectedRepo?.rootPath ?? platform.fs.paths.home;

	/** The scope's own variables: a repository's page leaves the inherited ones to their table. */
	const ownVars = useMemo(
		() =>
			vars.state !== "ready"
				? []
				: vars.data.filter((row) => repoId === null || row.scope !== "global"),
		[vars, repoId],
	);
	const existingNames = ownVars.map((row) => row.name);

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

	const addVariables = async (entries: readonly EnvDraft[]): Promise<boolean> => {
		for (const entry of entries) {
			const saved = await actions.settings.setEnvVar(entry.name, entry.value, scope);
			if (!saved.ok) {
				toastError(
					entries.length === 1
						? "Failed to add environment variable"
						: "Failed to add environment variables",
					saved.error,
				);
				return false;
			}
		}
		return true;
	};

	/** Saves one variable from the table's panel; a rename saves the new name, then drops the old. */
	const saveVariable = async (
		entry: EnvDraft & { previousName: string | null },
	): Promise<boolean> => {
		const saved = await actions.settings.setEnvVar(entry.name, entry.value, scope);
		if (!saved.ok) {
			toastError(ENV_SAVE_FAILED_MESSAGE, saved.error);
			return false;
		}
		if (entry.previousName !== null && entry.previousName !== entry.name) {
			const removed = await actions.settings.removeEnvVar(entry.previousName, scope);
			if (!removed.ok) {
				toastError(ENV_SAVE_FAILED_MESSAGE, removed.error);
				return false;
			}
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

	const copyVariable = async (name: string, value: string) => {
		const copied = await actions.app.copyText(value);
		if (!copied.ok) toastError(`Failed to copy ${name}`, copied.error);
		else toast(`Copied ${name}`);
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

	const revealVariable = async (name: string, from: EnvScope = scope): Promise<string | null> => {
		const read = await services.settings.revealEnvVar(name, from);
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

	const ownNames = new Set(existingNames);
	const rowsOf = (views: readonly EnvVarView[], editable: boolean): EnvTableRow[] =>
		orderSetNames(views.map((view) => view.name)).flatMap((name) => {
			const view = views.find((candidate) => candidate.name === name);
			if (view === undefined) return [];
			const description = documentedMeaning(name);
			return [
				{
					name,
					...(description === undefined ? {} : { description }),
					hasValue: view.hasValue,
					editable,
					canRename: description === undefined,
					dimmed: !editable && ownNames.has(name),
				},
			];
		});

	return (
		<SettingsPageFrame
			title="Environment"
			description="Configure environment variables used by Conducted and passed to agents."
			action={
				<Button size="sm" onClick={() => setAdding(true)}>
					<PlusIcon className="mr-1 size-3.5" />
					Add environment variable
				</Button>
			}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<div className="flex flex-col gap-6">
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

				<div className="flex flex-col gap-10">
					<LoadableView
						value={vars}
						loadingLabel="Loading environment variables"
						errorTitle="Couldn't load the environment variables"
						loading={<p className="text-sm text-fg-muted">Loading environment variables…</p>}
						onRetry={() => void services.settings.loadEnvVars(scope)}
					>
						{() => (
							<EnvVarTable
								scopeLabel="shared"
								rows={rowsOf(ownVars, true)}
								documented={unsetDocumentedEnvVars(existingNames)}
								onReveal={(name) => revealVariable(name)}
								onCopy={(name, value) => void copyVariable(name, value)}
								onSave={saveVariable}
								onDelete={removeVariable}
							/>
						)}
					</LoadableView>
					{repoId !== null && userVars.state === "ready" && userVars.data.length > 0 ? (
						<EnvVarTable
							title="Inherited from User"
							scopeLabel="inherited"
							rows={rowsOf(userVars.data, false)}
							hideEmptyState
							onReveal={(name) => revealVariable(name, "global")}
							onCopy={(name, value) => void copyVariable(name, value)}
							onSave={async () => false}
							onDelete={async () => false}
						/>
					) : null}
				</div>

				<div className="flex flex-col gap-3 border-t border-border pt-8">
					<div>
						<h2 className="text-sm font-medium text-fg">Env files</h2>
						<p className="text-sm text-fg-muted">
							Load environment variables from env files into the environment of your scripts and
							agents.
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

			<AddEnvVarForm
				open={adding}
				onOpenChange={setAdding}
				existingNames={existingNames}
				onAdd={addVariables}
			/>
		</SettingsPageFrame>
	);
}
