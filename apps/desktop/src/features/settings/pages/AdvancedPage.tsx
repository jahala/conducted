/**
 * @feature SET-02 Advanced settings page
 * Owns: the Advanced page of Settings: where files live, agent program paths, and terminal
 * history size.
 * Behaviour: ui-map.md 6, "Advanced" table; services-map.md 4.2.3. The "set upstream on plain
 * push" row stays on the Git page (one home per setting). Rows come from the settings registry
 * (SET-01).
 * Our design choice: a program path is checked against the file system before it is saved. An
 * invalid path is refused with a reason, so a saved path is always a path that exists.
 * Must handle: a path that does not exist, an empty value meaning the bundled program, and a root
 * folder change that asks for confirmation first.
 * Test first: saving a non-existent program path shows the error and does not call settings.set.
 *
 * PLAT-28 also renders the Agent binaries section here: the state of the Claude Code and Codex
 * programs and of Cursor's SDK (AGENT-09, installed only from here, D078), with Install or Retry,
 * Re-download and Remove. The programs themselves are downloaded and verified by the system
 * service, not by this page.
 */
import type { ManagedProgram, Result } from "@conducted/shared";
import { useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useAgentPrograms, useSetting } from "../../../core/hooks.ts";
import type { AgentProgramView } from "../../../core/model.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { RegistrySettingRows, SettingRow, useSettingSaves } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

const ROOT_PATH_KEY = "conducted_root_path";

export function AdvancedPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const { platform } = useServices();
	const actions = useActions();
	const saves = useSettingSaves();
	const rootPath = useSetting<string>(ROOT_PATH_KEY);
	const [pendingRoot, setPendingRoot] = useState<string | null>(null);
	const rootDef = getSettingDef(ROOT_PATH_KEY);

	const chooseRoot = async () => {
		const picked = await actions.app.pickFolder("Choose the root folder");
		if (!picked.ok) {
			toastError("Couldn't open the folder picker", picked.error);
			return;
		}
		if (picked.value !== null) setPendingRoot(picked.value);
	};

	const saveRoot = async () => {
		const next = pendingRoot;
		setPendingRoot(null);
		if (next === null) return;
		const saved = await saves.save(ROOT_PATH_KEY, next);
		if (saved) toast("Conductor root path changed successfully");
	};

	return (
		<SettingsPageFrame
			title="Advanced"
			description="Where the app keeps its data, which programs it runs, and how much terminal history it keeps."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<SettingRow
				settingKey={ROOT_PATH_KEY}
				title={rootDef?.title ?? "Root folder"}
				description={
					rootDef?.description ??
					"Where the app keeps cloned repositories and workspaces. Use an empty folder you do not edit by hand."
				}
				scope="user"
				disabledReason={null}
				highlighted={focusSettingKey === ROOT_PATH_KEY}
				saveError={saves.errorOf(ROOT_PATH_KEY)}
			>
				<div className="flex items-center gap-2">
					<Input
						aria-label="Root folder"
						value={rootPath}
						readOnly
						className="w-64 font-mono text-xs"
					/>
					<Button variant="secondary" onClick={() => void chooseRoot()}>
						Choose folder
					</Button>
				</div>
			</SettingRow>

			<RegistrySettingRows
				page="advanced"
				focusSettingKey={focusSettingKey}
				exclude={[ROOT_PATH_KEY]}
				beforeSave={async (def, value) => {
					if (!def.key.endsWith("_executable_path")) return null;
					const text = typeof value === "string" ? value.trim() : "";
					if (text === "") return null;
					const exists = await platform.fs.exists(text);
					return exists ? null : `No program exists at ${text}.`;
				}}
			/>

			<AgentBinaries />

			<AlertDialog
				open={pendingRoot !== null}
				onOpenChange={(open) => {
					if (!open) setPendingRoot(null);
				}}
			>
				<AlertDialogContent
					title="Change root path?"
					description="New repositories and workspaces will use the new folder. Existing ones stay where they are."
					confirmLabel="Change root path"
					onConfirm={() => void saveRoot()}
				/>
			</AlertDialog>
		</SettingsPageFrame>
	);
}

/** The agent programs the app downloads itself (D021), with the actions the user can take. */
function AgentBinaries() {
	const programs = useAgentPrograms();
	const actions = useActions();
	const [busy, setBusy] = useState<ManagedProgram | null>(null);

	const run = async (program: ManagedProgram, action: () => Promise<Result<void>>) => {
		setBusy(program);
		const result = await action();
		setBusy(null);
		if (!result.ok) toastError("Couldn't update the agent program", result.error);
	};

	return (
		<div className="flex flex-col gap-3 border-t border-border py-4">
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium text-fg">Agent binaries</p>
				<p className="max-w-prose text-sm text-fg-muted">
					The Claude Code and Codex programs and the Cursor SDK, which the app downloads, verifies
					and keeps up to date.
				</p>
			</div>
			{programs.state === "loading" ? (
				<p className="text-sm text-fg-subtle">Checking the agent programs.</p>
			) : programs.state === "error" ? (
				<p role="alert" className="text-sm text-danger">
					{programs.error.message}
				</p>
			) : programs.data.length === 0 ? (
				<p className="text-sm text-fg-subtle">No agent programs are managed.</p>
			) : (
				<ul className="flex flex-col gap-2">
					{programs.data.map((view) => (
						<AgentBinaryRow
							key={view.status.program}
							view={view}
							busy={busy === view.status.program}
							onInstall={() =>
								void run(view.status.program, () => actions.programs.install(view.status.program))
							}
							onRedownload={() =>
								void run(view.status.program, () =>
									actions.programs.redownload(view.status.program),
								)
							}
							onRemove={() =>
								void run(view.status.program, () => actions.programs.remove(view.status.program))
							}
						/>
					))}
				</ul>
			)}
		</div>
	);
}

function AgentBinaryRow({
	view,
	busy,
	onInstall,
	onRedownload,
	onRemove,
}: {
	view: AgentProgramView;
	busy: boolean;
	onInstall: () => void;
	onRedownload: () => void;
	onRemove: () => void;
}) {
	const { status } = view;
	const name = PROGRAM_NAMES[status.program] ?? status.program;
	const detail =
		view.userPath !== null
			? `Using the program at ${view.userPath}.`
			: describeProgramStatus(
					status.state,
					status.version,
					status.bytesDownloaded,
					status.bytesTotal,
					status.error,
				);
	const installed = status.state === "ready";

	return (
		<li className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
			<div className="flex min-w-0 flex-col gap-0.5">
				<p className="text-sm text-fg">{name}</p>
				<p className="text-xs text-fg-muted">{detail}</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{installed ? (
					<>
						<Button variant="secondary" size="sm" loading={busy} onClick={onRedownload}>
							Re-download
						</Button>
						<Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
							Remove
						</Button>
					</>
				) : (
					<Button variant="secondary" size="sm" loading={busy} onClick={onInstall}>
						{status.state === "failed" || status.state === "retrying" ? "Retry" : "Install"}
					</Button>
				)}
			</div>
		</li>
	);
}

/** The names the Agent binaries section shows. */
const PROGRAM_NAMES: Partial<Record<ManagedProgram, string>> = {
	claude: "Claude Code",
	codex: "Codex",
	cursor: "Cursor SDK",
};

function describeProgramStatus(
	state: AgentProgramView["status"]["state"],
	version: string | null,
	downloaded: number,
	total: number | null,
	error: string | null,
): string {
	switch (state) {
		case "ready":
			return version === null ? "Installed." : `Version ${version}.`;
		case "downloading":
			return total === null
				? `Downloading… ${formatBytes(downloaded)}`
				: `Downloading… ${formatBytes(downloaded)} of ${formatBytes(total)}`;
		case "verifying":
			return "Checking the download.";
		case "retrying":
			return error === null ? "Retrying." : `Retrying after a failure: ${error}`;
		case "failed":
			return error === null ? "The download failed." : `The download failed: ${error}`;
		case "queued":
			return "Waiting to download.";
		case "missing":
			return "Not downloaded yet.";
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
