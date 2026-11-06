/**
 * @feature APP-03 DiagnosticsScreen
 * Owns: the diagnostics route. It captures facts about the app and the user's environment, shows
 * them, and offers a redacted or full report, a chat with the report attached, the log export, and
 * a restart.
 * Behaviour: ui-map.md 2, route `/diagnostics` ("Capture information about your environment to
 * help diagnose issues"; shell, PATH and environment capture; buttons: copy redacted report, copy
 * full report, create a new session with the redacted report attached, copy logs (may include
 * personal data), restart; environment values are hashed except a safe list).
 * Data: useDiagnostics() (shaped by diagnostics-report.ts), useActions().app (exportLogs,
 * createDiagnosticsChat, copyText). Agent programs and the sidecar arrive in the capture.
 * Children: EnvironmentReport, DiagnosticsActions.
 * Must handle: capture loading and failing (a designed error with Retry), a very large
 * environment (the report component filters and collapses), secrets (never shown in the redacted
 * view), the full report asking first, the log export failing (message, nothing copied), a missing
 * login shell capture (the capture fails with its message), no workspace (the chat action is
 * disabled), and a restart while an agent is working (asks first).
 * Test first: with a capture that holds a variable named TOKEN, the redacted view shows a hash and
 * never the value.
 */
import { appError, err, messageOf, ok, type Result } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import type { Loadable } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useDiagnostics } from "../../core/hooks.ts";
import type { DiagnosticsCapture } from "../../core/model.ts";
import { canOpenWorkspace } from "../../core/workspace-open.ts";
import { Button } from "../../ui/Button.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { type DiagnosticsAction, DiagnosticsActions } from "./DiagnosticsActions.tsx";
import { redactCapture, renderReport, SAFE_ENV_NAMES, shortSha256 } from "./diagnostics-report.ts";
import { EnvironmentReport } from "./EnvironmentReport.tsx";

const DIAGNOSTICS_QUERY_KEY = ["system", "diagnostics"] as const;

export function DiagnosticsScreen() {
	const { services, platform } = useServices();
	const actions = useActions();
	const diagnostics = useDiagnostics();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const workspaces = useStore(services.workspace.store, (state) => state.workspacesById);
	const liveStates = useStore(services.sessions.store, (state) => state.liveStates);
	const [view, setView] = useState<"redacted" | "full">("redacted");
	const [busy, setBusy] = useState<DiagnosticsAction | null>(null);

	const openWorkspaces = Object.values(workspaces).filter(canOpenWorkspace);
	const targetWorkspace = [...openWorkspaces].sort(
		(left, right) => right.lastActivityAt - left.lastActivityAt,
	)[0];
	const agentsWorking = Object.values(liveStates).some((live) => live.status === "working");
	const capture = diagnostics.state === "ready" ? diagnostics.data : null;
	const home = platform.fs.paths.home;
	const [redaction, setRedaction] = useState<{
		from: DiagnosticsCapture;
		result: Result<DiagnosticsCapture>;
	} | null>(null);

	// Hashing is async (Web Crypto). Only the redaction of the capture on screen is kept, so a
	// slower redaction of an earlier capture never replaces a newer one.
	useEffect(() => {
		if (capture === null) return;
		let current = true;
		const options = { safeEnvNames: SAFE_ENV_NAMES, hash: shortSha256, homeDir: home };
		void redactCapture(capture, options).then(
			(value) => {
				if (current) setRedaction({ from: capture, result: ok(value) });
			},
			(cause: unknown) => {
				if (!current) return;
				const failure = appError("diagnostics_redaction_failed", messageOf(cause), cause);
				setRedaction({ from: capture, result: err(failure) });
			},
		);
		return () => {
			current = false;
		};
	}, [capture, home]);

	const settled = redaction !== null && redaction.from === capture ? redaction.result : null;
	const redacted = settled?.ok === true ? settled.value : null;
	const report: Loadable<DiagnosticsCapture> =
		diagnostics.state !== "ready"
			? diagnostics
			: settled === null
				? { state: "loading" }
				: settled.ok
					? diagnostics
					: { state: "error", error: settled.error };

	const retry = () => void queryClient.invalidateQueries({ queryKey: DIAGNOSTICS_QUERY_KEY });

	async function copyReport(captureToCopy: DiagnosticsCapture): Promise<boolean> {
		const copied = await actions.app.copyText(renderReport(captureToCopy));
		if (!copied.ok) {
			toastError("Couldn't copy the report", copied.error);
			return false;
		}
		return true;
	}

	async function runAction(action: DiagnosticsAction): Promise<void> {
		if (busy !== null || capture === null || redacted === null) return;
		setBusy(action);
		try {
			if (action === "copy_redacted") {
				if (await copyReport(redacted)) toast.success("Report copied");
				return;
			}
			if (action === "copy_full") {
				const confirmed = await platform.dialogs.confirm({
					title: "Copy the full report?",
					message:
						"The full report can include personal data such as environment values and file paths. Share it only with someone you trust.",
					okLabel: "Copy full report",
				});
				if (!confirmed) return;
				if (await copyReport(capture)) {
					setView("full");
					toast.success("Full report copied");
				}
				return;
			}
			if (action === "copy_logs") {
				const exported = await actions.app.exportLogs();
				if (!exported.ok) {
					toastError("Couldn't copy the logs", exported.error);
					return;
				}
				const text = await platform.fs.readText(exported.value);
				if (!text.ok) {
					toastError("Couldn't copy the logs", text.error);
					return;
				}
				const copied = await actions.app.copyText(text.value);
				if (!copied.ok) {
					toastError("Couldn't copy the logs", copied.error);
					return;
				}
				toast.success("App logs copied");
				return;
			}
			if (action === "start_chat") {
				if (targetWorkspace === undefined) return;
				const created = await actions.app.createDiagnosticsChat(targetWorkspace.id);
				if (!created.ok) {
					toastError("Couldn't start a chat from diagnostics", created.error);
					return;
				}
				const sessionId = services.sessions.store.getState().byWorkspace[targetWorkspace.id]?.[0];
				await navigate({
					to: "/repository/$repositoryId/workspace/$workspaceId",
					params: {
						repositoryId: targetWorkspace.repoId,
						workspaceId: targetWorkspace.id,
					},
					search: sessionId === undefined ? {} : { tab: "session", sessionId },
				});
				return;
			}
			if (action === "restart") {
				if (!services.updates.isSafeToQuit()) {
					const confirmed = await platform.dialogs.confirm({
						title: "Restart while an agent is working?",
						message:
							"An agent is still working. Restarting now stops it, and the turn is marked interrupted.",
						okLabel: "Restart anyway",
					});
					if (!confirmed) return;
				}
				await platform.updater.relaunch();
			}
		} catch (cause) {
			toastError("Couldn't finish the diagnostics action", {
				message: cause instanceof Error ? cause.message : String(cause),
			});
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="h-full overflow-auto">
			<div className="mx-auto flex max-w-3xl flex-col gap-6 px-10 py-8">
				<header className="flex flex-col gap-2">
					<h1 className="text-xl font-medium text-fg">Diagnostics</h1>
					<p className="text-sm text-fg-muted">
						Gather details about Conducted, your Mac and its shell to help diagnose a problem.
						Environment values are hashed unless they are safe to share.
					</p>
				</header>

				<LoadableView
					value={report}
					loadingLabel="Capturing diagnostics"
					errorTitle="Couldn't capture diagnostics"
					onRetry={retry}
				>
					{() =>
						capture === null || redacted === null ? null : (
							<div className="flex flex-col gap-6">
								<DiagnosticsActions
									busy={busy}
									canStartChat={targetWorkspace !== undefined}
									agentsWorking={agentsWorking}
									onAction={(action) => void runAction(action)}
								/>
								{view === "full" ? (
									<div className="flex items-center justify-between gap-3 rounded-md border border-warning bg-surface px-3 py-2">
										<p className="text-sm text-fg">
											Full values are visible. Treat this report as private.
										</p>
										<Button variant="outline" size="sm" onClick={() => setView("redacted")}>
											Hide values again
										</Button>
									</div>
								) : null}
								<EnvironmentReport capture={view === "redacted" ? redacted : capture} view={view} />
							</div>
						)
					}
				</LoadableView>
			</div>
		</div>
	);
}
