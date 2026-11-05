/**
 * @feature PRJ-01 Add project button
 * Owns: the button that adds a project: ask for a folder (app.pickFolder), call projects.addLocal, show the outcome.
 * Behaviour: ui-map.md 3.9 and 4 item 8 ("Add project...", "Open project"), 7.2 ("Add a project to get started."),
 * inventory text R@10176291 ("Recents" group of recently opened project folders).
 * Our design choice: with no project yet the button opens the folder dialog directly, so a first run is one click.
 * Once a project exists it opens the Add project menu with "Open project..." and a "Recents" group. Cloning from
 * GitHub (PRJ-02) and quick start (PRJ-03) join that menu once those services exist.
 * Must handle: the user cancels the folder dialog (no message, no change); the dialog fails (a toast); the folder is not a git repository or
 * is already added (the action returns an error, shown as a toast with its plain-language message); a second
 * click while one add is running does nothing; the button shows progress while working.
 * Test first: with a stand-in action that returns ok, clicking calls projects.addLocal with the picked folder.
 */

import { useState } from "react";
import { useActions, useRepos } from "../../core/hooks.ts";
import type { Repo } from "../../core/model.ts";
import { Button, type ButtonProps } from "../../ui/Button.tsx";
import { ChevronDownIcon, FolderPlusIcon } from "../../ui/icons.tsx";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuSeparator,
	MenuTrigger,
} from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";

/** How many recently opened folders the menu lists. */
export const RECENTS_LIMIT = 5;

/** The folders shown under "Recents": most recently updated first. */
export function recentProjects(repos: readonly Repo[], limit = RECENTS_LIMIT): Repo[] {
	return [...repos].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export function AddProjectButton({
	variant = "secondary",
	size = "md",
	className,
}: Pick<ButtonProps, "variant" | "size" | "className">) {
	const actions = useActions();
	const repos = useRepos();
	const [busy, setBusy] = useState(false);
	const recents = repos.state === "ready" ? recentProjects(repos.data) : [];
	const label = variant === "default" && size === "lg" ? "Open project" : "Add a project";

	const addProject = async (path?: string) => {
		if (busy) return;
		setBusy(true);
		try {
			let folder = path;
			if (folder === undefined) {
				const picked = await actions.app.pickFolder("Add a project");
				if (!picked.ok) {
					toastError("Couldn't open the folder dialog", picked.error);
					return;
				}
				if (picked.value === null) return;
				folder = picked.value;
			}
			const result = await actions.projects.addLocal(folder);
			if (!result.ok) toastError("Couldn't add the project", result.error);
		} finally {
			setBusy(false);
		}
	};

	if (recents.length === 0) {
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
				<MenuSeparator />
				<MenuLabel>Recents</MenuLabel>
				{recents.map((repo) => (
					<MenuItem key={repo.id} onSelect={() => void addProject(repo.rootPath)}>
						{repo.name}
					</MenuItem>
				))}
			</MenuContent>
		</Menu>
	);
}
