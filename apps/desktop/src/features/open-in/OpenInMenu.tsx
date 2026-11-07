/**
 * @feature WS-08 OpenInMenu
 * Owns: the "Open in" control in the workspace header: a button that opens the workspace folder in
 * the last used app, and a menu of the installed Finder, editors, terminals, IDEs and git tools,
 * ending with "Copy path". Conductor keeps copying the folder path in this menu, after the apps
 * (wWn, renderApp @2508600); there is no separate folder chip (D098).
 * Behaviour: ui-map.md 3.10 ("Open in" app menu; Cmd+O opens in the default app, Cmd+Shift+O opens
 * the menu); the order of recently used apps and the default app are settings (open_in_mru_order,
 * default_open_in in services-map.md 4.2.3).
 * Data: useWorkspace (path, archived), useActions().workspaces.openIn(id, appName), and useOpenInApps
 * for the listed apps and the default one (shared with the file tab's "Open in another app").
 * Children: OpenInButton, OpenInItem; open-in-apps.ts for the catalog and ordering.
 * Must handle: the installed-apps list loading or failing (Finder alone still works), no editor
 * installed (only Finder), the default app having been uninstalled (falls back to the first
 * available, visibly), an open that fails (the Conductor toast title), an archived workspace
 * (menu disabled with the reason), Cmd+O when no default is set (opens the menu), and a copy that
 * fails (a toast).
 * Test first: with Cursor and Finder installed and Cursor last used, the button label is Cursor
 * and the menu lists Cursor first.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { CopyIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuLabel } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { OpenInButton } from "./OpenInButton.tsx";
import { OpenInItem } from "./OpenInItem.tsx";
import { type OpenInApp, openInFailureTitle } from "./open-in-apps.ts";
import { useOpenInApps } from "./use-open-in-apps.ts";

export function OpenInMenu({ workspaceId }: { workspaceId: WorkspaceId }) {
	const workspace = useWorkspace(workspaceId);
	const actions = useActions();
	const [menuOpen, setMenuOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	// One open at a time: a second click or Cmd+O while an app is opening joins the first.
	const flight = useRef(createSingleFlight<"open">()).current;

	const { apps, defaultApp, storedDefault, recentNames, listFailed } = useOpenInApps();

	const archived = workspace.state === "ready" && isArchivedWorkspace(workspace.data);
	const disabledReason =
		workspace.state === "loading"
			? "Loading the workspace."
			: workspace.state === "error"
				? workspace.error.message
				: archived
					? "This workspace is archived."
					: null;

	const open = useCallback(
		(app: OpenInApp): Promise<void> => {
			if (workspace.state !== "ready" || isArchivedWorkspace(workspace.data)) {
				return Promise.resolve();
			}
			return flight.run("open", async () => {
				setBusy(true);
				setMenuOpen(false);
				try {
					const opened = await actions.workspaces.openIn(workspaceId, app.appName);
					if (!opened.ok) {
						toastError(openInFailureTitle(opened.error), opened.error);
						return;
					}
					const next = [app.appName, ...recentNames.filter((name) => name !== app.appName)];
					const written = await actions.settings.set("open_in_mru_order", next.join(","));
					if (!written.ok) toastError("Couldn't remember the last app", written.error);
				} finally {
					setBusy(false);
				}
			});
		},
		[actions, flight, workspace, workspaceId, recentNames],
	);

	const setDefault = useCallback(
		(app: OpenInApp) => {
			void actions.settings.set("default_open_in", app.appName).then((result) => {
				if (!result.ok) toastError("Couldn't set the default app", result.error);
			});
		},
		[actions],
	);

	const copyPath = () => {
		if (workspace.state !== "ready") return;
		void actions.app.copyText(workspace.data.path).then((result) => {
			if (!result.ok) toastError("Couldn't copy the folder path", result.error);
		});
	};

	const openDefault = useCallback(() => {
		if (defaultApp === null) {
			setMenuOpen(true);
			return;
		}
		void open(defaultApp);
	}, [defaultApp, open]);

	useCommandHandler("workspace.openIn", "base", () => {
		if (disabledReason !== null) return true;
		if (storedDefault === "") {
			setMenuOpen(true);
			return true;
		}
		if (defaultApp !== null) void open(defaultApp);
		return true;
	});

	useCommandHandler("workspace.openInMenu", "base", () => {
		if (disabledReason === null) setMenuOpen(true);
		return true;
	});

	return (
		<Menu open={menuOpen} onOpenChange={setMenuOpen}>
			<OpenInButton
				defaultApp={defaultApp}
				busy={busy}
				disabledReason={disabledReason}
				onOpenDefault={openDefault}
				menuOpen={menuOpen}
				onMenuOpenChange={setMenuOpen}
			/>
			<MenuContent aria-label="Open in">
				{apps.map((app) => (
					<OpenInItem
						key={app.appName}
						app={app}
						isDefault={app.appName === defaultApp?.appName}
						onOpen={(chosen) => void open(chosen)}
						onSetDefault={setDefault}
					/>
				))}
				{listFailed ? <MenuLabel>Could not list the apps on this Mac.</MenuLabel> : null}
				<MenuItem icon={<CopyIcon />} onSelect={copyPath}>
					Copy path
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}
