/**
 * @feature WS-08 OpenInMenu
 * Owns: the "Open in" control in the workspace header: a button that opens the workspace folder in
 * the last used app, and a menu of the installed Finder, editors, terminals, IDEs and git tools.
 * Behaviour: ui-map.md 3.10 ("Open in" app menu; Cmd+O opens in the default app, Cmd+Shift+O opens
 * the menu); the order of recently used apps and the default app are settings (open_in_mru_order,
 * default_open_in in services-map.md 4.2.3).
 * Data: useWorkspace (path, archived), useSetting for the default and recent order,
 * useActions().workspaces.openIn(id, appName). Which apps are installed comes from useInstalledApps.
 * Children: OpenInButton, OpenInItem; open-in-apps.ts for the catalog and ordering.
 * Must handle: the installed-apps list loading or failing (Finder alone still works), no editor
 * installed (only Finder), the default app having been uninstalled (falls back to the first
 * available, visibly), an open that fails (the Conductor toast title), an archived workspace
 * (menu disabled with the reason), and Cmd+O when no default is set (opens the menu).
 * Test first: with Cursor and Finder installed and Cursor last used, the button label is Cursor
 * and the menu lists Cursor first.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useActions, useInstalledApps, useSetting, useWorkspace } from "../../core/hooks.ts";
import { Menu, MenuContent, MenuLabel } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { OpenInButton } from "./OpenInButton.tsx";
import { OpenInItem } from "./OpenInItem.tsx";
import {
	type OpenInApp,
	openInCatalog,
	openInFailureTitle,
	visibleOpenInApps,
} from "./open-in-apps.ts";

const NO_APPS: readonly string[] = [];

const parseRecent = (value: string): string[] =>
	value
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name !== "");

export function OpenInMenu({ workspaceId }: { workspaceId: WorkspaceId }) {
	const workspace = useWorkspace(workspaceId);
	const actions = useActions();
	const installed = useInstalledApps();
	const storedDefault = useSetting<string>("default_open_in");
	const recentSetting = useSetting<string>("open_in_mru_order");
	const [menuOpen, setMenuOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const opening = useRef(false);

	const recentNames = useMemo(() => parseRecent(recentSetting), [recentSetting]);
	const installedNames = installed.state === "ready" ? installed.data : NO_APPS;
	const apps = useMemo(
		() => visibleOpenInApps(openInCatalog(), installedNames, recentNames),
		[installedNames, recentNames],
	);
	const defaultApp = apps.find((app) => app.appName === storedDefault) ?? apps[0] ?? null;

	const archived = workspace.state === "ready" && workspace.data.state === "archived";
	const disabledReason =
		workspace.state === "loading"
			? "Loading the workspace."
			: workspace.state === "error"
				? workspace.error.message
				: archived
					? "This workspace is archived."
					: null;

	const open = useCallback(
		async (app: OpenInApp) => {
			if (workspace.state !== "ready" || workspace.data.state === "archived") return;
			if (opening.current) return;
			opening.current = true;
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
				opening.current = false;
				setBusy(false);
			}
		},
		[actions, workspace, workspaceId, recentNames],
	);

	const setDefault = useCallback(
		(app: OpenInApp) => {
			void actions.settings.set("default_open_in", app.appName).then((result) => {
				if (!result.ok) toastError("Couldn't set the default app", result.error);
			});
		},
		[actions],
	);

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
				{installed.state === "error" ? (
					<MenuLabel>Could not list the apps on this Mac.</MenuLabel>
				) : null}
			</MenuContent>
		</Menu>
	);
}
