/**
 * @feature SET-07 Repository Scripts page
 * Owns: the per-repository Scripts page: the setup script, the archive script, the run mode, and
 * auto-run after setup.
 * Behaviour: ui-map.md 6, "Scripts (repo)" and "Scripts page" (Setup script runs when a workspace
 * is created; Archive script runs before archiving; run mode); services-map.md 5A.1.1 to 5A.1.4
 * (three kinds of script, run_script_mode concurrent or exclusive, shared file read-only).
 * Left out: the conductor.json migration banner (our files start in the new format).
 * Data: useRepoConfig(repoId), useActions().projects.updateConfig(repoId, patch).
 * Rows (our wording), RepoConfig field, control:
 *   Setup script                  setupScript                  multi-line code field
 *   Archive script                archiveScript                multi-line code field
 *   Run mode                      runMode                      select: runs may overlap across
 *                                                              workspaces, or only one workspace runs
 *   Start the default action      autoRunAfterSetup            switch
 *                                                              after setup
 * Our design choice: edits are saved to the personal settings file on blur, and the app never
 * writes the shared file. Values are shown as a summary of what runs around a workspace.
 * Must handle: loading and error, an unsaved edit kept until the field loses focus, a save that
 * fails (text kept and the failure shown), and a script containing `$VARIABLE` names (the list of
 * variables the app provides is shown as help).
 * Test first: editing the setup script and blurring calls updateConfig with the new setupScript
 * alone.
 */
import type { RepoId } from "@conducted/shared";
import { useEffect, useState } from "react";
import { useActions, useRepoConfig } from "../../../core/hooks.ts";
import type { RepoConfig, RepoConfigPatch } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { Label, Textarea } from "../../../ui/Input.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Select } from "../../../ui/Select.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { toastError } from "../../../ui/Toast.tsx";
import { RUN_FOLDER_VARIABLES } from "../../scripts-panel/run/AddActionDialog.tsx";

const RUN_MODES = [
	{ value: "concurrent" as const, label: "Run together" },
	{ value: "exclusive" as const, label: "One at a time" },
];

export function RepoScriptsPage({ repoId }: { repoId: RepoId }) {
	const value = useRepoConfig(repoId);
	const actions = useActions();
	const [setupScript, setSetupScript] = useState("");
	const [archiveScript, setArchiveScript] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);
	const ready = value.state === "ready" ? value.data : null;

	useEffect(() => {
		if (ready === null) return;
		setSetupScript(ready.setupScript ?? "");
		setArchiveScript(ready.archiveScript ?? "");
	}, [ready]);

	const save = async (patch: RepoConfigPatch) => {
		const saved = await actions.projects.updateConfig(repoId, patch);
		if (!saved.ok) {
			setSaveError(saved.error.message);
			toastError("Couldn't save the scripts", saved.error);
			return;
		}
		setSaveError(null);
	};

	const textOrNull = (text: string): string | null => (text.trim() === "" ? null : text);

	/**
	 * The script drafts that differ from the saved config. Every save carries them, so it never
	 * drops text typed in the other field, and it names no field the user left alone.
	 */
	const draftChanges = (
		config: RepoConfig,
		typed: { setupScript: string; archiveScript: string } = { setupScript, archiveScript },
	): RepoConfigPatch => {
		const patch: RepoConfigPatch = {};
		for (const field of ["setupScript", "archiveScript"] as const) {
			const text = textOrNull(typed[field]);
			if (text !== config[field]) patch[field] = text;
		}
		return patch;
	};

	const saveIfChanged = (patch: RepoConfigPatch) => {
		if (Object.keys(patch).length === 0) return;
		void save(patch);
	};

	const saveText = (field: "setupScript" | "archiveScript", text: string) => {
		if (value.state !== "ready") return;
		saveIfChanged(draftChanges(value.data, { setupScript, archiveScript, [field]: text }));
	};

	const setRunMode = (runMode: RepoConfig["runMode"]) => {
		if (value.state !== "ready") return;
		const patch = draftChanges(value.data);
		if (runMode !== value.data.runMode) patch.runMode = runMode;
		saveIfChanged(patch);
	};

	const setAutoRun = (autoRunAfterSetup: boolean) => {
		if (value.state !== "ready") return;
		const patch = draftChanges(value.data);
		if (autoRunAfterSetup !== value.data.autoRunAfterSetup) {
			patch.autoRunAfterSetup = autoRunAfterSetup;
		}
		saveIfChanged(patch);
	};

	const retry = () => {
		if (value.state !== "ready") return;
		void save(draftChanges(value.data));
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">Scripts</h1>
				<p className="text-sm text-fg-muted">
					Commands that run when workspaces are set up or archived.
				</p>
			</div>

			<LoadableView
				value={value}
				loadingLabel="Loading scripts"
				errorTitle="Couldn't load the scripts"
				loading={
					<div className="flex flex-col gap-4">
						<Skeleton className="h-28 w-full" />
						<Skeleton className="h-28 w-full" />
					</div>
				}
			>
				{(config) => (
					<div className="flex flex-col gap-6">
						<div className="flex flex-col gap-1.5 border-t border-border pt-4">
							<Label htmlFor="repo-setup-script">Setup script</Label>
							<p className="text-sm text-fg-muted">Runs when a new workspace is created</p>
							<Textarea
								id="repo-setup-script"
								value={setupScript}
								className="font-mono"
								placeholder="pnpm install"
								onChange={(event) => setSetupScript(event.target.value)}
								onBlur={() => saveText("setupScript", setupScript)}
							/>
						</div>

						<div className="flex flex-col gap-1.5 border-t border-border pt-4">
							<Label htmlFor="repo-archive-script">Archive script</Label>
							<p className="text-sm text-fg-muted">Runs before a workspace is archived</p>
							<Textarea
								id="repo-archive-script"
								value={archiveScript}
								className="font-mono"
								placeholder="pnpm clean"
								onChange={(event) => setArchiveScript(event.target.value)}
								onBlur={() => saveText("archiveScript", archiveScript)}
							/>
						</div>

						<div className="flex items-center justify-between gap-4 border-t border-border pt-4">
							<div>
								<p className="text-sm font-medium text-fg">Run mode</p>
								<p className="text-sm text-fg-muted">
									Whether several run actions can work at the same time or each one stops the
									others.
								</p>
							</div>
							<Select
								aria-label="Run mode"
								value={config.runMode}
								options={RUN_MODES}
								onValueChange={setRunMode}
							/>
						</div>

						<div className="flex items-center justify-between gap-4 border-t border-border pt-4">
							<div>
								<p className="text-sm font-medium text-fg">Start the default action after setup</p>
								<p className="text-sm text-fg-muted">
									Start the repository's default action once the setup script has finished.
								</p>
							</div>
							<Switch
								checked={config.autoRunAfterSetup}
								aria-label="Start the default action after setup"
								onCheckedChange={setAutoRun}
							/>
						</div>

						<div className="rounded-md bg-muted p-3 text-xs text-fg-muted">
							<p className="font-medium text-fg">Variables in scripts</p>
							<p className="mt-1 font-mono">
								{RUN_FOLDER_VARIABLES.map((name) => `$${name}`).join("  ")}
							</p>
						</div>

						{saveError !== null ? (
							<div className="flex items-center justify-between gap-3">
								<p role="alert" className="text-sm text-danger">
									{saveError}
								</p>
								<Button variant="secondary" onClick={retry}>
									Try again
								</Button>
							</div>
						) : null}
					</div>
				)}
			</LoadableView>
		</div>
	);
}
