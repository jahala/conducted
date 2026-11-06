/**
 * @feature REV-08 Open a file outside the file tab
 * Owns: the two ways the file tab hands a file it cannot show to macOS: "Open in another app" (the
 * app the "Open in" menu opens by default: the chosen one when installed, else the first listed,
 * as Conductor does) and "Reveal in Finder".
 * Behaviour: ui-map.md 7.4 (file previews fail with "Preview unavailable"), 3.10 (the "Open in"
 * default app); the failure toast titles are WS-08's, from open-in-apps.ts.
 * Must handle: an empty app list ("No default app configured"), an app that cannot open the path,
 * and Finder refusing; each failure is a toast, never a thrown error.
 * Test first: clicking "Reveal in Finder" for a binary file reveals its absolute path.
 */
import type { WorkspaceId } from "@conducted/shared";
import { appError } from "@conducted/shared";
import { useActions } from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import { openInFailureTitle } from "../open-in/open-in-apps.ts";
import { useOpenInApps } from "../open-in/use-open-in-apps.ts";

export interface OpenElsewhere {
	openInApp: () => void;
	reveal: () => void;
}

export function useOpenElsewhere(workspaceId: WorkspaceId, path: string): OpenElsewhere {
	const actions = useActions();
	const { defaultApp } = useOpenInApps();
	return {
		openInApp: () => {
			if (defaultApp === null) {
				const none = appError("open_in_no_default_app", "No app is listed in the Open in menu.");
				toastError(openInFailureTitle(none), none);
				return;
			}
			void actions.files.openInApp(workspaceId, path, defaultApp.appName).then((result) => {
				if (!result.ok) toastError(openInFailureTitle(result.error), result.error);
			});
		},
		reveal: () => {
			void actions.files.reveal(workspaceId, path).then((result) => {
				if (!result.ok) toastError("Couldn't reveal the file in Finder", result.error);
			});
		},
	};
}
