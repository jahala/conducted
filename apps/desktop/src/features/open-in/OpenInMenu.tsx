/**
 * @feature WS-08 OpenInMenu
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Owns: the "Open in" control in the workspace header: a button that opens the workspace folder in
 * the last used app, and a menu of the installed Finder, editors, terminals, IDEs and git tools,
 * ending with "Copy path". Conductor keeps copying the folder path in this menu, after the apps
 * (wWn, renderApp @2508600); there is no separate folder chip (D098).
 * A cloud workspace's menu is "Open via SSH": only VS Code, Cursor and Zed, plus "Copy SSH
 * command" (CLOUD-12). Its default app falls back to the first of those three.
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
import { useCallback, useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useWorkspace } from "../../core/hooks.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { CopyIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuLabel } from "../../ui/Menu.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { OpenInButton } from "./OpenInButton.tsx";
import { OpenInItem } from "./OpenInItem.tsx";
import {
	defaultOpenInApp,
	type OpenInApp,
	openInFailureTitle,
	remoteOpenInApps,
} from "./open-in-apps.ts";
import { useOpenInApps, useOpenInChoices } from "./use-open-in-apps.ts";

export function OpenInMenu({ workspaceId }: { workspaceId: WorkspaceId }) {
	const workspace = useWorkspace(workspaceId);
	const actions = useActions();
	const [menuOpen, setMenuOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	// One open at a time: a second click or Cmd+O while an app is opening joins the first.
	const flight = useRef(createSingleFlight<"open">()).current;

	const all = useOpenInApps();
	const { remember, setDefault } = useOpenInChoices(all.recentNames);
	const cloud = workspace.state === "ready" && workspace.data.host.kind === "cloud";
	const apps = cloud ? remoteOpenInApps(all.apps) : all.apps;
	const defaultApp = cloud ? defaultOpenInApp(apps, all.storedDefault) : all.defaultApp;
	const { storedDefault, listFailed } = all;

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
					await remember(app);
				} finally {
					setBusy(false);
				}
			});
		},
		[actions, flight, workspace, workspaceId, remember],
	);

	const copyPath = () => {
		if (workspace.state !== "ready") return;
		void actions.app.copyText(workspace.data.path).then((result) => {
			if (!result.ok) toastError("Couldn't copy the folder path", result.error);
		});
	};

	/** Copy SSH command (CLOUD-12): opens the door, then puts Conductor's `ssh <name>` on the clipboard. */
	const copySsh = useCallback(() => {
		if (workspace.state !== "ready") return;
		void (async () => {
			try {
				const command = await actions.workspaces.copySshCommand(workspaceId);
				if (!command.ok) {
					toastError("Failed to copy SSH command", command.error);
					return;
				}
				const copied = await actions.app.copyText(command.value);
				if (!copied.ok) {
					toastError("Failed to copy SSH command", copied.error);
					return;
				}
				toast.success("Copied SSH command");
				setMenuOpen(false);
			} catch (caught) {
				toastError("Failed to copy SSH command", { message: String(caught) });
			}
		})();
	}, [actions, workspace, workspaceId]);

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

	useCommandHandler("workspace.openRemoteInApp", "base", () => {
		if (disabledReason !== null || !cloud) return false;
		if (storedDefault === "" || defaultApp === null) {
			setMenuOpen(true);
			return true;
		}
		void open(defaultApp);
		return true;
	});

	return (
		<Menu open={menuOpen} onOpenChange={setMenuOpen}>
			<OpenInButton
				defaultApp={defaultApp}
				remote={cloud}
				busy={busy}
				disabledReason={disabledReason}
				onOpenDefault={openDefault}
				menuOpen={menuOpen}
				onMenuOpenChange={setMenuOpen}
			/>
			<OpenInMenuContent
				apps={apps}
				defaultApp={defaultApp}
				listFailed={listFailed}
				onOpen={(chosen) => void open(chosen)}
				onSetDefault={setDefault}
				onCopyPath={copyPath}
				onCopySsh={cloud ? copySsh : undefined}
			/>
		</Menu>
	);
}

/**
 * The menu every Open in control shows: the apps, then Conductor's "Copy path" (wWn, renderApp
 * @2508600), shared by the workspace header and Settings' "Open settings.toml".
 */
export function OpenInMenuContent({
	apps,
	defaultApp,
	listFailed,
	onOpen,
	onSetDefault,
	onCopyPath,
	onCopySsh,
}: {
	apps: readonly OpenInApp[];
	defaultApp: OpenInApp | null;
	listFailed: boolean;
	onOpen: (app: OpenInApp) => void;
	onSetDefault: (app: OpenInApp) => void;
	onCopyPath: () => void;
	/** Present on a cloud workspace: the "Copy SSH command" item (CLOUD-12). */
	onCopySsh?: () => void;
}) {
	return (
		<MenuContent align="end" aria-label="Open in">
			{apps.map((app) => (
				<OpenInItem
					key={app.appName}
					app={app}
					isDefault={app.appName === defaultApp?.appName}
					onOpen={onOpen}
					onSetDefault={onSetDefault}
				/>
			))}
			{listFailed ? <MenuLabel>Could not list the apps on this Mac.</MenuLabel> : null}
			{onCopySsh === undefined ? null : (
				<MenuItem icon={<CopyIcon />} onSelect={onCopySsh}>
					Copy SSH command
				</MenuItem>
			)}
			<MenuItem icon={<CopyIcon />} onSelect={onCopyPath}>
				Copy path
			</MenuItem>
		</MenuContent>
	);
}
