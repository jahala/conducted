/**
 * @feature APP-08 Start-up blocker screens
 * Owns: the full-window screens for a start that cannot go on: "Database from a newer version" with an
 * Update button, "Wrong version of Conducted for this Mac" (an Intel build on Apple silicon), and "Failed to
 * start agents" with "Copy diagnostics" and "Retry".
 * Behaviour: ui-map.md 7.4 (app-level blockers: "Database from a newer version" with Update; "Wrong version
 * of Conductor for this Mac"; "Failed to start agents / Conductor will not work. Please report this error.");
 * coverage/settings-states-kit.md (the failed state has `logPath`; offer "Copy diagnostics" and "Retry").
 * Left out on purpose: the "Database rollback" terminal (staff tool), "Update required" and "isn't available
 * in your region" (hosted service checks, D025).
 * Data: `StartupState` from app/startup.ts for the first and third screens. The CPU facts come from
 * useSystemInfo (core/hooks/system.ts, PLAT-32): `machineArch` arm64 with `buildArch` x86_64. Update runs
 * `Actions.app.checkForUpdates`; diagnostics copy through `Actions.app.copyText`.
 * Our design choice: the wrong-CPU screen offers "Continue anyway" through the softer confirm dialog in
 * features/updates/RosettaConfirm.tsx, so the hard block is not the only way forward.
 * Product name: the screens say "Conducted" (see StartupScreen.tsx).
 * Must handle: a database newer than the app (the screen names both versions and says the data is untouched,
 * and Update is the one primary action); a failed start with or without a log path (the message is shown, and
 * diagnostics still copy it); the wrong-CPU mismatch with a download action and a continue action; the window
 * draggable; the message in plain words, never a stack trace.
 * Test first: a `blocked` state shows "Database from a newer version" and an Update button; clicking it
 * checks for updates once.
 */
import { useState } from "react";
import type { SystemInfo } from "../core/model.ts";
import { RosettaConfirm } from "../features/updates/RosettaConfirm.tsx";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { FullPage } from "./FullPage.tsx";
import type { StartupState } from "./startup.ts";

export type StartupBlocker =
	| Extract<StartupState, { kind: "blocked" } | { kind: "failed" }>
	| { kind: "wrong_cpu_build"; system: SystemInfo };

export interface StartupFailureProps {
	blocker: StartupBlocker;
	onUpdate: () => void;
	onRetry: () => void;
	onCopyDiagnostics: () => void;
	onQuit: () => void;
	/** Wrong-CPU screen only: continue with this build after the confirm dialog. */
	onContinueAnyway?: () => void;
	/** Where the build for this Mac can be downloaded. Null when unknown. */
	downloadUrl?: string | null;
}

export function StartupFailure({
	blocker,
	onUpdate,
	onRetry,
	onCopyDiagnostics,
	onQuit,
	onContinueAnyway,
	downloadUrl = null,
}: StartupFailureProps) {
	const [confirmOpen, setConfirmOpen] = useState(false);

	if (blocker.kind === "wrong_cpu_build") {
		return (
			<FullPage>
				<EmptyState
					tone="failed"
					title="Wrong version of Conducted for this Mac"
					body="This is the Intel build of Conducted, and this Mac has Apple silicon. Download the Apple silicon build to get the fastest, most reliable version."
					action={
						<div className="flex flex-col items-center gap-2">
							<div className="flex flex-wrap justify-center gap-2">
								<Button onClick={onUpdate}>Update</Button>
								<Button variant="secondary" onClick={() => setConfirmOpen(true)}>
									Continue anyway
								</Button>
								<Button variant="ghost" onClick={onQuit}>
									Quit
								</Button>
							</div>
							<p className="max-w-prose text-xs text-fg-subtle">
								Conducted works under Rosetta, but slowly and with some features missing.
							</p>
						</div>
					}
				/>
				<RosettaConfirm
					open={confirmOpen}
					onOpenChange={(open) => {
						setConfirmOpen(open);
						if (!open) onContinueAnyway?.();
					}}
					system={blocker.system}
					downloadUrl={downloadUrl}
				/>
			</FullPage>
		);
	}

	if (blocker.kind === "blocked") {
		return (
			<FullPage>
				<EmptyState
					tone="failed"
					title="Database from a newer version"
					body={`This database (schema version ${blocker.databaseVersion}) was created by a newer version of Conducted than the one running (which supports up to version ${blocker.appVersion}). Update Conducted to continue. Your work is untouched.`}
					action={
						<div className="flex flex-wrap justify-center gap-2">
							<Button onClick={onUpdate}>Update</Button>
							<Button variant="ghost" onClick={onQuit}>
								Quit
							</Button>
						</div>
					}
				/>
			</FullPage>
		);
	}

	return (
		<FullPage>
			<EmptyState
				tone="failed"
				title="Failed to start agents"
				body="Conducted will not work. Please report this error."
				action={
					<div className="flex max-w-prose flex-col items-center gap-3">
						<p className="text-sm text-fg-muted">{blocker.message}</p>
						{blocker.logPath === null ? null : (
							<p className="break-all text-xs text-fg-subtle">{blocker.logPath}</p>
						)}
						<div className="flex flex-wrap justify-center gap-2">
							<Button onClick={onRetry}>Retry</Button>
							<Button variant="secondary" onClick={onCopyDiagnostics}>
								Copy diagnostics
							</Button>
							<Button variant="ghost" onClick={onQuit}>
								Quit
							</Button>
						</div>
					</div>
				}
			/>
		</FullPage>
	);
}
