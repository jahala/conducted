/**
 * @feature RUN-03 Opening a localhost URL
 * Owns: `useUrlOpeners`, the one way the Run tab and the Ports tab open a localhost URL: in the
 * system browser, or in the workspace's in-app browser tab.
 * Behaviour: ui-map.md 3.7 ("Open", "Choose preview URL", "Open localhost URL" Cmd+Shift+B) and 6
 * ("In-app browser preview": the preview button opens an in-app browser tab instead of the
 * external browser); services-map.md settings table, `experimental_in_app_browser_preview`.
 * Must handle: the setting off (the preview opens in the system browser, and there is no in-app
 * opener), the setting on (the preview opens this workspace's browser tab at the URL), a system
 * browser that cannot open the URL (an error toast).
 * Test first: with the setting on, Open in the Run tab moves to the browser tab at that URL.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useActions, useSetting, useWorkspace } from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";

export interface UrlOpeners {
	/** Opens the URL in the system browser. */
	inBrowser: (url: string) => void;
	/** Opens the URL in the workspace's in-app browser tab. Null while the setting is off. */
	inPreview: ((url: string) => void) | null;
	/** The preview button: the in-app browser tab when the setting is on, else the system browser. */
	preview: (url: string) => void;
}

export function useUrlOpeners(workspaceId: WorkspaceId): UrlOpeners {
	const actions = useActions();
	const navigate = useNavigate();
	const workspace = useWorkspace(workspaceId);
	const inAppEnabled = useSetting<boolean>("experimental_in_app_browser_preview") === true;

	const inBrowser = (url: string): void => {
		void (async () => {
			const opened = await actions.app.openUrl(url);
			if (!opened.ok) toastError("Couldn't open the URL", opened.error);
		})();
	};

	// The browser tab's route needs the repository id, so it exists once the workspace has loaded.
	// Both tabs show a spinner until then, so no button can call it earlier.
	const repoId = workspace.state === "ready" ? workspace.data.repoId : null;
	const inPreview =
		inAppEnabled && repoId !== null
			? (url: string): void => {
					void navigate({
						to: "/repository/$repositoryId/workspace/$workspaceId",
						params: { repositoryId: repoId, workspaceId },
						search: (previous) => ({ ...previous, tab: "browser", browserUrl: url }),
					});
				}
			: null;

	return { inBrowser, inPreview, preview: inPreview ?? inBrowser };
}
