/**
 * @feature APP-08 Wrong-CPU build confirm
 * Owns: the confirm dialog that warns when the Intel build runs on an Apple silicon Mac (under Rosetta) and
 * points to the right build.
 * Behaviour: ui-map.md 5.2 (the "<x> Conductor?" app-update and Rosetta confirms), 7.4 (the full-screen
 * "Wrong version of Conductor for this Mac"); coverage/shell-and-navigation.md (fold the Rosetta confirm
 * into APP-08).
 * Data: `SystemInfo` (machineArch, buildArch) from useSystemInfo. The download goes through
 * `Actions.app.openUrl` with the release page; the page address is passed in.
 * Our design choice: this dialog is the softer sibling of the full-screen blocker in app/StartupFailure.tsx.
 * It is for a window that is already open (for example after an update check finds an arm64 build for the
 * same version). The blocker is for start-up.
 * Must handle: the Mac and the build agree (the dialog never opens); no release page known (the dialog
 * explains the mismatch without a download button); "Continue anyway" closing the dialog and remembering
 * the choice for this app version; Escape and outside click behaving as "Continue anyway"; focus returning
 * to the previous control.
 * Test first: with machineArch "arm64" and buildArch "x86_64" the dialog opens and offers the download;
 * with equal values it renders nothing.
 */
import { notImplemented } from "@conducted/shared";
import type { SystemInfo } from "../../core/model.ts";
import type { OverlayProps } from "../../ui/overlay-props.ts";

export interface RosettaConfirmProps extends Pick<OverlayProps, "open" | "onOpenChange"> {
	system: SystemInfo;
	/** Where the build for this Mac can be downloaded. Null when unknown. */
	downloadUrl: string | null;
}

export function RosettaConfirm(_props: RosettaConfirmProps): never {
	return notImplemented("APP-08");
}
