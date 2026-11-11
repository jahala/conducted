/**
 * @feature SET-02 Advanced settings page
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Owns: the Advanced page of Settings: where files live, agent program paths, the SSH private key
 * path, and terminal history size.
 * Behaviour: ui-map.md 6, "Advanced" table; services-map.md 4.2.3. The "set upstream on plain
 * push" row stays on the Git page (one home per setting). Rows come from the settings registry
 * (SET-01).
 * Our design choice: a program path is checked against the file system before it is saved. An
 * invalid path is refused with a reason, so a saved path is always a path that exists.
 * Must handle: a path that does not exist, an empty value meaning the bundled program, and a root
 * folder change that asks for confirmation first and names the old and new path (D037 keeps the
 * existing data, unlike Conductor's wipe). A finished change reloads the chats, refreshes projects
 * and workspaces, opens Home and toasts, as Conductor does (renderApp @10966029).
 * Test first: saving a non-existent program path shows the error and does not call settings.set.
 *
 * PLAT-28 also renders the Agent binaries section here: the state of the Claude Code and Codex
 * programs and of Cursor's SDK (AGENT-09, installed only from here, D083), with Install or Retry,
 * Re-download and Remove. PLAT-35 adds a Helper programs section for gh and watchexec, kept apart
 * from the agent programs, so a failed or missing download of either shows its error and Retry
 * here instead of running a copy on PATH (D088). A successful install toasts "Installed <name>.",
 * as Conductor does (renderApp @10982892); Re-download and Remove have no success toast there. The
 * programs themselves are downloaded and verified by the system service, not by this page.
 */
import type { ManagedProgram, Result } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServices } from "../../../core/context.tsx";
import {
	useActions,
	useAgentPrograms,
	useHelperPrograms,
	useSetting,
} from "../../../core/hooks.ts";
import type { AgentProgramView } from "../../../core/model.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { PROGRAM_DISPLAY_NAMES } from "../../../core/system.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { FolderIcon } from "../../../ui/icons.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { PROGRAM_PATHS, ProgramPathRow } from "../program-path.tsx";
import { RegistrySettingRows, SettingRow, useSettingSaves } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";
import { SshKeyPathRow } from "../ssh-key-path.tsx";

const ROOT_PATH_KEY = "conductor_root_path";

export function AdvancedPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const actions = useActions();
	const services = useServices().services;
	const navigate = useNavigate();
	const saves = useSettingSaves();
	const rootPath = useSetting<string>(ROOT_PATH_KEY);
	const [pendingRoot, setPendingRoot] = useState<string | null>(null);
	const rootDef = getSettingDef(ROOT_PATH_KEY);

	const chooseRoot = async () => {
		const picked = await actions.app.pickFolder("Select Conducted root directory");
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
		if (!saved) return;
		// Conductor reloads its chat state, refreshes workspaces and repos, then opens Home
		// (renderApp @10966029). D037 keeps the existing data, so the reload finds it unchanged.
		await services.sessions.start();
		await services.workspace.start();
		await services.repo.start();
		void navigate({ to: "/" });
		toast.success("Conducted root path changed successfully");
	};

	return (
		<SettingsPageFrame
			title="Advanced"
			description={null}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<SettingRow
				settingKey={ROOT_PATH_KEY}
				title={rootDef?.title ?? "Conducted root directory"}
				description={
					rootDef?.description ??
					"Where Conducted stores repositories and workspaces. This should be an empty directory that you don't modify directly."
				}
				disabledReason={null}
				highlighted={focusSettingKey === ROOT_PATH_KEY}
				saveError={saves.errorOf(ROOT_PATH_KEY)}
				stacked
			>
				{/* Conductor's row: the path at full width, then "Browse" with a folder icon. */}
				<div className="flex w-full items-center gap-2">
					<Input
						aria-label="Conducted root directory"
						value={rootPath}
						readOnly
						className="min-w-0 flex-1"
					/>
					<Button variant="outline" onClick={() => void chooseRoot()}>
						<FolderIcon />
						Browse
					</Button>
				</div>
			</SettingRow>

			{PROGRAM_PATHS.map((program) => (
				<ProgramPathRow
					key={program.key}
					settingKey={program.key}
					label={program.label}
					binary={program.binary}
					focusSettingKey={focusSettingKey}
				/>
			))}

			<SshKeyPathRow focusSettingKey={focusSettingKey} />

			<RegistrySettingRows
				page="advanced"
				focusSettingKey={focusSettingKey}
				exclude={[ROOT_PATH_KEY, "ssh_key_path", ...PROGRAM_PATHS.map((program) => program.key)]}
			/>

			<AgentBinaries />

			<HelperPrograms />

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
				>
					<div className="space-y-2 text-sm">
						<div className="flex items-start gap-2">
							<span className="shrink-0 text-fg-muted">Old root path:</span>
							<span className="font-mono break-all">{rootPath}</span>
						</div>
						<div className="flex items-start gap-2">
							<span className="shrink-0 text-fg-muted">New root path:</span>
							<span className="font-mono break-all">{pendingRoot}</span>
						</div>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsPageFrame>
	);
}

/** The agent programs the app downloads itself (D021), with the actions the user can take. */
function AgentBinaries() {
	const programs = useAgentPrograms();
	const actions = useActions();
	const [busy, setBusy] = useState<ManagedProgram | null>(null);

	/**
	 * Runs one program action. An install or re-download that fails says so in Conductor's words
	 * ("Failed to install <name>: <message>"); Conductor has no remove, so a failed remove shows the
	 * error's own message.
	 */
	const run = async (
		program: ManagedProgram,
		action: () => Promise<Result<void>>,
		messages: { success?: string; installing?: boolean } = {},
	) => {
		setBusy(program);
		const result = await action();
		setBusy(null);
		if (!result.ok) {
			toast.error(
				messages.installing === true
					? `Failed to install ${PROGRAM_DISPLAY_NAMES[program]}: ${result.error.message}`
					: result.error.message,
			);
			return;
		}
		if (messages.success !== undefined) toast.success(messages.success);
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
								void run(view.status.program, () => actions.programs.install(view.status.program), {
									success: `Installed ${PROGRAM_DISPLAY_NAMES[view.status.program]}.`,
									installing: true,
								})
							}
							onRedownload={() =>
								void run(
									view.status.program,
									() => actions.programs.redownload(view.status.program),
									{ installing: true },
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

/**
 * The helper programs the app downloads for its own commands (PLAT-35), kept apart from the agent
 * programs as Conductor's page does. A failed or missing download shows its error here with Retry,
 * so the app never needs a copy on PATH (D088).
 */
function HelperPrograms() {
	const programs = useHelperPrograms();
	const actions = useActions();
	const [busy, setBusy] = useState<ManagedProgram | null>(null);

	/**
	 * Runs one program action. An install or re-download that fails says so in Conductor's words
	 * ("Failed to install <name>: <message>"); Conductor has no remove, so a failed remove shows the
	 * error's own message.
	 */
	const run = async (
		program: ManagedProgram,
		action: () => Promise<Result<void>>,
		messages: { success?: string; installing?: boolean } = {},
	) => {
		setBusy(program);
		const result = await action();
		setBusy(null);
		if (!result.ok) {
			toast.error(
				messages.installing === true
					? `Failed to install ${PROGRAM_DISPLAY_NAMES[program]}: ${result.error.message}`
					: result.error.message,
			);
			return;
		}
		if (messages.success !== undefined) toast.success(messages.success);
	};

	return (
		<div className="flex flex-col gap-3 border-t border-border py-4">
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium text-fg">Helper programs</p>
				<p className="max-w-prose text-sm text-fg-muted">
					The GitHub CLI and watchexec, which the app downloads for GitHub and Spotlight.
				</p>
			</div>
			{programs.state === "loading" ? (
				<p className="text-sm text-fg-subtle">Checking the helper programs.</p>
			) : programs.state === "error" ? (
				<p role="alert" className="text-sm text-danger">
					{programs.error.message}
				</p>
			) : programs.data.length === 0 ? (
				<p className="text-sm text-fg-subtle">No helper programs are managed.</p>
			) : (
				<ul className="flex flex-col gap-2">
					{programs.data.map((view) => (
						<AgentBinaryRow
							key={view.status.program}
							view={view}
							busy={busy === view.status.program}
							onInstall={() =>
								void run(view.status.program, () => actions.programs.install(view.status.program), {
									success: `Installed ${PROGRAM_DISPLAY_NAMES[view.status.program]}.`,
									installing: true,
								})
							}
							onRedownload={() =>
								void run(
									view.status.program,
									() => actions.programs.redownload(view.status.program),
									{ installing: true },
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
	const name = PROGRAM_DISPLAY_NAMES[status.program];
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
