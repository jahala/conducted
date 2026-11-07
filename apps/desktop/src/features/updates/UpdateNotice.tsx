/**
 * @feature APP-06 UpdateNotice
 * Owns: the sidebar notice for a downloaded update that installs when every agent is idle, the
 * restart confirm that waits for working agents, the "what's new" notice after an update, and the
 * focus re-check of the update feed. Entry point embedded by the sidebar footer.
 * Behaviour: ui-map.md 1.3 ("Will automatically restart when all agents are idle", "Restart when
 * idle", "See changes"), 5.2 ("<x> Conductor?" app-update confirm); services-map.md 5B.4.1
 * (download failures; checks hourly and on focus) and 4.2.3 (last_seen_announcement).
 * Data: useUpdateStatus() (state idle, checking, available, downloading, ready_when_idle, error;
 * version; notesUrl; error), useSetting for the auto-restart switch and the last-seen
 * announcement, useActions().app (installUpdate, checkForUpdates, openUrl) and
 * useActions().settings.set. The text and actions per state are in update-notice-view.ts.
 * Our design choice: the notice is always mounted in the sidebar footer, so it also owns the
 * ten-minute focus re-check. "Restart when idle" asks the service to restart once the last working
 * chat is idle, even when the automatic setting is off, because the user asked for it.
 * Must handle: nothing to show when idle or checking, the notice appearing while the user types
 * (no focus steal), an update that fails (an error notice and one toast), the user choosing Restart
 * when idle while an agent is working (a confirm, then the app waits), dismissal until the next
 * version, release notes that cannot be opened, and an installed update whose release notes cannot
 * be read.
 * Test first: with state "ready_when_idle" and auto-restart off, the notice offers "Restart when
 * idle" and calls installUpdate once on click.
 */
import { messageOf } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { fireAndForget } from "../../core/async/fire-and-forget.ts";
import { useServices } from "../../core/context.tsx";
import { useActions, useSetting, useUpdateStatus } from "../../core/hooks.ts";
import { UPDATE_FOCUS_RECHECK_MS } from "../../core/services/updates.ts";
import { AlertDialog, AlertDialogContent } from "../../ui/AlertDialog.tsx";
import { Button } from "../../ui/Button.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { describeUpdate, type UpdateNoticeView } from "./update-notice-view.ts";

interface WhatsNew {
	version: string;
	notes: string;
}

export function UpdateNotice() {
	const { platform, services } = useServices();
	const status = useUpdateStatus();
	const autoRestart = useSetting<boolean>("auto_restart_on_update_when_idle") === true;
	const lastSeenAnnouncement = useSetting<string>("last_seen_announcement");
	const actions = useActions();
	const anyChatWorking = useStore(services.sessions.store, (state) =>
		Object.values(state.liveStates).some((live) => live.status === "working"),
	);

	const [dismissed, setDismissed] = useState<string | null>(null);
	const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);
	const [whatsNew, setWhatsNew] = useState<WhatsNew | null>(null);
	const [whatsNewHidden, setWhatsNewHidden] = useState(false);
	const lastToastedError = useRef<string | null>(null);

	useEffect(() => {
		if (status.state !== "error" || status.error === null) {
			lastToastedError.current = null;
			return;
		}
		if (lastToastedError.current === status.error) return;
		lastToastedError.current = status.error;
		const notesUrl = status.notesUrl;
		toast.error("Update failed", {
			description: status.error,
			...(notesUrl === null
				? {}
				: {
						action: {
							label: "See changes",
							onClick: () => {
								void (async () => {
									const opened = await actions.app.openUrl(notesUrl);
									if (opened.ok) return;
									toastError("Couldn't open the release notes", opened.error);
								})();
							},
						},
					}),
		});
	}, [status.state, status.error, status.notesUrl, actions]);

	useEffect(() => {
		let active = true;
		platform.updater.installedUpdate().then(
			(found) => {
				if (!active) return;
				if (!found.ok) {
					toastError("Couldn't read the release notes", found.error);
					return;
				}
				if (found.value !== null && found.value.notes.trim() !== "") {
					setWhatsNew(found.value);
				}
			},
			(cause: unknown) => {
				if (active) {
					toastError("Couldn't read the release notes", { message: messageOf(cause) });
				}
			},
		);
		return () => {
			active = false;
		};
	}, [platform]);

	useEffect(() => {
		let lastCheckedAt = Date.now();
		return platform.window.onFocusChanged((focused) => {
			if (!focused) return;
			const now = Date.now();
			if (now - lastCheckedAt < UPDATE_FOCUS_RECHECK_MS) return;
			const current = services.updates.store.getState().state;
			if (current === "checking" || current === "downloading") return;
			lastCheckedAt = now;
			fireAndForget(
				async () => {
					const outcome = await actions.app.checkForUpdates();
					if (!outcome.ok) return;
				},
				(cause) => {
					toastError("Couldn't check for updates", { message: messageOf(cause) });
				},
			);
		});
	}, [platform, services, actions]);

	const view: UpdateNoticeView | null = describeUpdate(status, autoRestart);
	const primary = view?.primary ?? null;
	const noticeKey = `${status.state}:${status.version ?? status.error ?? ""}`;
	const showNotice = view !== null && dismissed !== noticeKey;
	const showWhatsNew =
		whatsNew !== null && !whatsNewHidden && whatsNew.version !== lastSeenAnnouncement;

	const checkNow = async (): Promise<void> => {
		const outcome = await actions.app.checkForUpdates();
		if (outcome.ok) return;
		toastError("Couldn't check for updates", outcome.error);
	};

	const installNow = async (): Promise<void> => {
		const outcome = await actions.app.installUpdate();
		if (!outcome.ok) return;
	};

	const runPrimary = async (id: "download" | "restart_when_idle" | "retry"): Promise<void> => {
		if (id === "restart_when_idle" && anyChatWorking) {
			setRestartConfirmOpen(true);
			return;
		}
		if (id === "retry" && status.version === null) {
			await checkNow();
			return;
		}
		await installNow();
	};

	const openReleaseNotes = async (): Promise<void> => {
		if (status.notesUrl === null) return;
		const opened = await actions.app.openUrl(status.notesUrl);
		if (opened.ok) return;
		toastError("Couldn't open the release notes", opened.error);
	};

	const dismissWhatsNew = async (): Promise<void> => {
		if (whatsNew === null) return;
		setWhatsNewHidden(true);
		const saved = await actions.settings.set("last_seen_announcement", whatsNew.version);
		if (saved.ok) return;
		toastError("Couldn't remember that you saw the release notes", saved.error);
	};

	return (
		<>
			{showWhatsNew ? (
				<div className="flex items-start gap-2 rounded-md border border-border bg-hover px-2 py-1.5 text-fg">
					<div className="min-w-0 flex-1">
						<p className="text-xs font-medium">What&apos;s new in {whatsNew.version}</p>
						<p className="mt-0.5 whitespace-pre-wrap text-xs text-fg-muted">{whatsNew.notes}</p>
						<Button
							size="xs"
							variant="ghost"
							className="mt-1"
							onClick={() => {
								void dismissWhatsNew();
							}}
						>
							Dismiss what&apos;s new
						</Button>
					</div>
				</div>
			) : null}
			{showNotice && view !== null ? (
				<div className="flex items-start gap-2 rounded-md border border-border bg-hover px-2 py-1.5 text-fg">
					<div className="min-w-0 flex-1">
						<p
							className="text-xs font-medium"
							title={status.state === "error" && status.error !== null ? status.error : undefined}
						>
							{view.text}
						</p>
						{primary !== null || view.showSeeChanges ? (
							<div className="mt-1 flex items-center gap-1.5">
								{primary !== null ? (
									<Button
										size="xs"
										variant={status.state === "error" ? "outline" : "default"}
										onClick={() => {
											void runPrimary(primary.id);
										}}
									>
										{primary.label}
									</Button>
								) : null}
								{view.showSeeChanges ? (
									<Button
										size="xs"
										variant="ghost"
										onClick={() => {
											void openReleaseNotes();
										}}
									>
										See changes
									</Button>
								) : null}
							</div>
						) : null}
					</div>
					<button
						type="button"
						aria-label="Dismiss update notice"
						onClick={() => {
							setDismissed(noticeKey);
						}}
						className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-sm text-fg-muted hover:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
					>
						<span aria-hidden="true">×</span>
					</button>
				</div>
			) : null}
			<AlertDialog open={restartConfirmOpen} onOpenChange={setRestartConfirmOpen}>
				<AlertDialogContent
					title="Restart Conducted?"
					description="Agents are still working. Conducted will restart when they are idle."
					confirmLabel="Restart when idle"
					onConfirm={() => {
						setRestartConfirmOpen(false);
						void installNow();
					}}
				/>
			</AlertDialog>
		</>
	);
}
