/**
 * @feature PRJ-01 Add project button
 * Owns: the button that adds a project: ask for a folder (app.pickFolder), call projects.addLocal, show the outcome.
 * Behaviour: ui-map.md 3.9 and 4 item 8 ("Add project...", "Open project"), 7.2 ("Add a project to get started.").
 * Our design choice: with no project yet the button opens the folder dialog directly, so a first run is one click.
 * Once a project exists it opens the Add project menu with "Open project...". Cloning from GitHub (PRJ-02) and
 * quick start (PRJ-03) join that menu once those services exist.
 * Must handle: the user cancels the folder dialog (no message, no change); the dialog fails (a toast); the folder is not a git repository or
 * is already added (the action returns an error, shown as a toast with its plain-language message); a second
 * click while one add is running does nothing; the button shows progress while working.
 * Test first: with a stand-in action that returns ok, clicking calls projects.addLocal with the picked folder.
 */

import { useState } from "react";
import { useActions, useRepos } from "../../core/hooks.ts";
import { Button, type ButtonProps } from "../../ui/Button.tsx";
import { ChevronDownIcon, FolderPlusIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";

export function AddProjectButton({
	variant = "secondary",
	size = "md",
	className,
}: Pick<ButtonProps, "variant" | "size" | "className">) {
	const actions = useActions();
	const repos = useRepos();
	const [busy, setBusy] = useState(false);
	const hasProjects = repos.state === "ready" && repos.data.length > 0;
	const label = variant === "default" && size === "lg" ? "Open project" : "Add a project";

	const addProject = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const picked = await actions.app.pickFolder("Add a project");
			if (!picked.ok) {
				toastError("Couldn't open the folder dialog", picked.error);
				return;
			}
			if (picked.value === null) return;
			const result = await actions.projects.addLocal(picked.value);
			if (!result.ok) toastError("Couldn't add the project", result.error);
		} finally {
			setBusy(false);
		}
	};

	if (!hasProjects) {
		return (
			<Button
				variant={variant}
				size={size}
				loading={busy}
				className={className}
				onClick={() => void addProject()}
			>
				<FolderPlusIcon />
				{label}
			</Button>
		);
	}

	return (
		<Menu>
			<MenuTrigger asChild>
				<Button variant={variant} size={size} loading={busy} className={className}>
					<FolderPlusIcon />
					{label}
					<ChevronDownIcon />
				</Button>
			</MenuTrigger>
			<MenuContent align="start">
				<MenuItem icon={<FolderPlusIcon />} onSelect={() => void addProject()}>
					Open project...
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}
