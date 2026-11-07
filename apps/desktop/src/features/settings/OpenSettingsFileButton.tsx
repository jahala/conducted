/**
 * @feature SET-02 Open the settings file
 * Owns: the "Open settings.toml" control in the settings top bar: a split button whose main part
 * opens the user's settings file (or, on a repository page, that repository's
 * settings.local.toml) in the default Open in app, and whose arrow lists the other apps and
 * "Copy path".
 * Behaviour: Conductor's settings layout puts this control at the right of its 40 px top bar
 * (renderApp rrl and yC with type "file-secondary", @11766000 and @2503868): an outlined button
 * with the app's icon and the file name in mono, the tooltip "Open in <app>", and an arrow whose
 * tooltip is "Open in...". The file is created empty first when it is missing.
 * Data: useOpenInApps and useOpenInChoices (the same apps and default as the workspace header),
 * useActions().settings.openFile and filePath, useActions().app.copyText.
 * Must handle: no app listed yet (both parts disabled), an open that fails (Conductor's Open in
 * toast title), a second click while an open runs (ignored), and a copy that fails (a toast).
 * Test first: the top bar opens settings.toml in the default app.
 */
import type { RepoId } from "@conducted/shared";
import { useRef, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { ChevronDownIcon } from "../../ui/icons.tsx";
import { Menu, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { OpenInAppIcon } from "../open-in/OpenInItem.tsx";
import { OpenInMenuContent } from "../open-in/OpenInMenu.tsx";
import { type OpenInApp, openInFailureTitle } from "../open-in/open-in-apps.ts";
import { useOpenInApps, useOpenInChoices } from "../open-in/use-open-in-apps.ts";

export interface OpenSettingsFileButtonProps {
	/** The user's own file, or one repository's local file. */
	file: "user" | { repoId: RepoId };
}

export function OpenSettingsFileButton({ file }: OpenSettingsFileButtonProps) {
	const actions = useActions();
	const { apps, defaultApp, recentNames, listFailed } = useOpenInApps();
	const { remember, setDefault } = useOpenInChoices(recentNames);
	const [menuOpen, setMenuOpen] = useState(false);
	const flight = useRef(createSingleFlight<"open">()).current;
	const fileName = file === "user" ? "settings.toml" : "settings.local.toml";
	const label = `Open ${fileName}`;

	const open = (app: OpenInApp) => {
		setMenuOpen(false);
		void flight.run("open", async () => {
			const opened = await actions.settings.openFile(file, app.appName);
			if (!opened.ok) {
				toastError(openInFailureTitle(opened.error), opened.error);
				return;
			}
			await remember(app);
		});
	};

	const copyPath = () => {
		void actions.settings.filePath(file).then(async (path) => {
			if (!path.ok) {
				toastError("Couldn't copy the file path", path.error);
				return;
			}
			const copied = await actions.app.copyText(path.value);
			if (!copied.ok) toastError("Couldn't copy the file path", copied.error);
		});
	};

	const noApp = defaultApp === null;
	return (
		<Menu open={menuOpen} onOpenChange={setMenuOpen}>
			<div className="flex min-w-0 max-w-[260px]">
				<Tooltip content={defaultApp === null ? label : `Open in ${defaultApp.label}`}>
					<Button
						variant="outline"
						size="xs"
						disabled={noApp}
						onClick={() => {
							if (defaultApp !== null) open(defaultApp);
						}}
						className="min-w-0 flex-1 justify-start gap-2 overflow-hidden rounded-r-none border-r-0 pr-2 font-mono font-medium"
					>
						{defaultApp === null ? null : (
							<OpenInAppIcon app={defaultApp} className="size-3" decorative />
						)}
						<span className="min-w-0 truncate">{label}</span>
					</Button>
				</Tooltip>
				<Tooltip content="Open in...">
					<MenuTrigger asChild>
						<Button
							variant="outline"
							size="xs"
							aria-label="Open in..."
							aria-expanded={menuOpen}
							disabled={apps.length === 0}
							onClick={() => setMenuOpen(!menuOpen)}
							className="rounded-l-none px-2"
						>
							<ChevronDownIcon className="size-3" />
						</Button>
					</MenuTrigger>
				</Tooltip>
			</div>
			<OpenInMenuContent
				apps={apps}
				defaultApp={defaultApp}
				listFailed={listFailed}
				onOpen={open}
				onSetDefault={setDefault}
				onCopyPath={copyPath}
			/>
		</Menu>
	);
}
