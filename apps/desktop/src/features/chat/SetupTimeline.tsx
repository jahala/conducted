/**
 * @feature WS-03 Setup script in a terminal
 * Owns: the setup timeline a new local workspace shows in its chat before the first message: the
 * copy and folder it is, the branch it came from, the files copied, and where its setup script is.
 * Behaviour: Conductor's timeline (renderApp `ZBs` @2976800 to @2982300, shown by `Kma` @9613405
 * while no chat of the workspace has a user message): "You’re in a new copy of <repo> called
 * <folder>", "Branched <branch> from <base>", "Created <folder> and copied N files" ("copying..."
 * while it is made), then one setup line: "Setup did not start" after a failed creation (with
 * "Workspace initialization failed", Retry and Delete), "Detecting setup script...", "Running setup
 * script..." with Stop, "Stopping setup script...", "Setup script failed — fix it?", "Cancelled
 * setup script", "Completed setup script", or "Optional: add a setup script" without one.
 * "Setup script failed — fix it?" sends the fix request with the end of the setup log to the
 * workspace's chat, as the Setup tab's Ask agent to fix does (requestSetupFix).
 * Must handle: an archived or cloud workspace, or a chat of it with a message (nothing shown); a
 * workspace with no chat when fix is pressed
 * ("No active session to attach setup logs to"); a fix whose send fails (a toast); Stop, Retry
 * and Delete pressed twice (each waits for the first); the repository still loading (its name is
 * left out until it loads).
 * Test first: a failed setup offers "Setup script failed — fix it?", which sends the fix request
 * to the workspace's chat.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useServices } from "../../core/context.tsx";
import {
	useActions,
	useRepos,
	useSessions,
	useSetupState,
	useWorkspace,
} from "../../core/hooks.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { Button } from "../../ui/Button.tsx";
import {
	CheckIcon,
	ChevronRightIcon,
	CircleIcon,
	CloseIcon,
	GitBranchIcon,
} from "../../ui/icons.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { requestSetupFix, setupRequestChat } from "../scripts-panel/setup/SetupTab.tsx";
import { deleteWorkspace } from "../workspace/archive-workspace.tsx";

/** One line of the timeline with its mark: done, running, or not started. */
function Step({
	state,
	icon,
	children,
}: {
	state: "complete" | "in_progress" | "not_started";
	icon?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 text-sm text-fg-muted">
			<span className="flex size-4 shrink-0 items-center justify-center">
				{state === "in_progress" ? <Spinner label="In progress" size="sm" /> : icon}
			</span>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

const muted = "size-3.5 text-fg-muted";

export function SetupTimeline({ workspaceId }: { workspaceId: WorkspaceId }) {
	const actions = useActions();
	const navigate = useNavigate();
	const workspaceService = useServices().services.workspace;
	const workspace = useWorkspace(workspaceId);
	const repos = useRepos();
	const setup = useSetupState(workspaceId);
	const sessions = useSessions(workspaceId);
	const [busy, setBusy] = useState(false);

	if (workspace.state !== "ready" || sessions.state !== "ready") return null;
	const row = workspace.data;
	if (isArchivedWorkspace(row) || row.state === "archiving" || row.host.kind !== "local") {
		return null;
	}
	// Conductor shows it until a chat of the workspace has a message (renderApp `Kma`).
	if (sessions.data.some((chat) => chat.lastUserMessageAt !== null)) return null;
	const repo = repos.state === "ready" ? repos.data.find((entry) => entry.id === row.repoId) : null;
	const view = setup.state === "ready" ? setup.data : null;
	const chats = sessions.data;
	// Ours marks a workspace failed when its setup script fails, where Conductor keeps it ready and
	// fails only the script. A failed script run is read as Conductor's script failure, so only a
	// workspace that could not be made reads as an initialization failure.
	const scriptFailed = view?.state === "failed";
	const initFailed = row.state === "failed" && !scriptFailed;

	const once = (work: () => Promise<void>) => {
		if (busy) return;
		setBusy(true);
		void work().finally(() => setBusy(false));
	};

	const openScripts = () =>
		void navigate({
			to: "/settings/repos/$repoId/$page",
			params: { repoId: row.repoId, page: "scripts" },
		});

	const fix = () => {
		const chat = setupRequestChat(row, chats);
		if (chat === undefined) {
			toast.error("No active session to attach setup logs to");
			return;
		}
		once(async () => {
			const sent = await requestSetupFix(actions, workspaceService, {
				workspaceId,
				sessionId: chat.id,
				hasSavedLog: view?.log === "saved",
			});
			if (!sent.ok) toastError("Failed to attach setup logs", sent.error);
		});
	};

	const setupLine = (): ReactNode => {
		if (initFailed) {
			return (
				<Step state="not_started" icon={<CircleIcon className={muted} />}>
					Setup did not start
				</Step>
			);
		}
		if (row.state === "initializing" || view === null) {
			return (
				<Step state="not_started" icon={<CircleIcon className={muted} />}>
					Detecting setup script...
				</Step>
			);
		}
		if (!view.hasScript) {
			return (
				<Step state="not_started" icon={<ChevronRightIcon className={muted} />}>
					<button
						type="button"
						onClick={openScripts}
						className="inline-flex items-center gap-0.5 text-fg-muted hover:text-fg"
					>
						Optional: add a setup script
						<ChevronRightIcon className="size-3" />
					</button>
				</Step>
			);
		}
		if (view.state === "running" || view.state === "detecting") {
			return (
				<Step state="in_progress">
					<span className="flex flex-wrap items-center gap-2">
						Running setup script...
						<Button
							variant="outline"
							size="xs"
							disabled={busy}
							onClick={() =>
								once(async () => {
									const stopped = await workspaceService.cancelSetup(workspaceId);
									if (!stopped.ok) toastError("Couldn't stop the setup script", stopped.error);
								})
							}
						>
							Stop
						</Button>
					</span>
				</Step>
			);
		}
		if (view.state === "stopping") {
			return <Step state="in_progress">Stopping setup script...</Step>;
		}
		if (view.state === "failed") {
			return (
				<Step state="complete" icon={<CloseIcon className="size-3.5 text-danger" />}>
					<button
						type="button"
						disabled={busy}
						onClick={fix}
						className="text-danger hover:text-danger/80"
					>
						Setup script failed — fix it?
					</button>
				</Step>
			);
		}
		if (view.state === "cancelled") {
			return (
				<Step state="complete" icon={<CloseIcon className={muted} />}>
					Cancelled setup script
				</Step>
			);
		}
		return (
			<Step state="complete" icon={<CheckIcon className={muted} />}>
				<span className="flex items-center gap-1">
					Completed
					<button
						type="button"
						onClick={openScripts}
						className="inline-flex items-center gap-1 hover:text-fg"
					>
						setup script
						<ChevronRightIcon className="size-3" />
					</button>
				</span>
			</Step>
		);
	};

	return (
		<div className="mx-auto w-full max-w-4xl space-y-4 px-7 pt-6 text-left select-text">
			<div className="rounded-lg bg-muted p-3">
				<h3 className="min-w-0 text-sm font-medium break-words text-fg">
					You’re in a new copy of{" "}
					<span className="font-mono font-medium break-all">{repo?.name ?? ""}</span> called{" "}
					<span className="font-mono font-medium break-all">{row.directoryName}</span>
				</h3>
			</div>
			<div className="space-y-4">
				{row.branch !== "" && row.targetBranch !== "" ? (
					<Step state="complete" icon={<GitBranchIcon className={muted} />}>
						Branched <span className="font-mono font-medium">{row.branch}</span> from{" "}
						<span className="font-mono font-medium">{row.targetBranch}</span>
					</Step>
				) : null}
				<Step
					state={row.state === "initializing" ? "in_progress" : "complete"}
					icon={
						initFailed ? (
							<CloseIcon className="size-3.5 text-danger" />
						) : (
							<CheckIcon className={muted} />
						)
					}
				>
					{initFailed ? (
						<span className="flex flex-wrap items-center gap-2">
							<span className="text-danger">Workspace initialization failed</span>
							<Button
								variant="outline"
								size="xs"
								disabled={busy}
								onClick={() =>
									once(async () => {
										const retried = await actions.workspaces.retrySetup(workspaceId);
										if (!retried.ok) toastError("Couldn't run setup again", retried.error);
									})
								}
							>
								Retry
							</Button>
							<Button
								variant="outline"
								size="xs"
								disabled={busy}
								onClick={() => once(() => deleteWorkspace(actions, workspaceId))}
							>
								Delete
							</Button>
						</span>
					) : (
						<span>
							Created <span className="font-mono font-medium text-fg">{row.directoryName}</span> and{" "}
							{row.state === "initializing" ? "copying..." : `copied ${row.filesCopied ?? 0} files`}
						</span>
					)}
				</Step>
				{setupLine()}
			</div>
		</div>
	);
}
