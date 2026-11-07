/**
 * @feature PRJ-01 Add project button
 * Owns: the three ways to add a project (Open project, Open GitHub project, Quick start) as one set of menu
 * items; the button that holds them on the empty states; and the sidebar's add-project menu that the
 * "Add project" command (Cmd+Alt+A, the palette's "Add project", the list header menu's "Add project…")
 * opens.
 * Behaviour: ui-map.md 3.9 ("Open project", "Open GitHub project", "Quick start"), 5.1 (palette "Add
 * project"), 5.4 (Cmd+Alt+A), 7.2 ("Add a project to get started."). Measured from Conductor 0.92.1: the
 * shortcut, the palette item and the "My workspaces" header menu all open one 320px menu under the right
 * end of the list header, holding Open project, Open GitHub project and Quick start (renderApp @10174083,
 * @10495160, @11385888; main @3784822). Conductor has no add-project button in the sidebar footer.
 * Our design choice: with no project yet the empty-state button opens the folder dialog directly, so a
 * first run is one click; once a project exists it opens the same three items. Conductor's menu also lists
 * "Recents", folders opened before that are not projects yet; we keep no such list, so it is left out.
 * Must handle: the user cancels the folder dialog (no message, no change); the dialog fails (a toast); the folder is not a git repository or
 * is already added (the action returns an error, shown as a toast with its plain-language message); a second
 * click while one add is running does nothing; the button shows progress while working; the command
 * opening the sidebar menu while another menu is closing.
 * Test first: with a stand-in action that returns ok, clicking calls projects.addLocal with the picked folder.
 */

import { useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useRepos } from "../../core/hooks.ts";
import { Button, type ButtonProps } from "../../ui/Button.tsx";
import { ChevronDownIcon, FolderIcon, FolderPlusIcon, GlobeIcon } from "../../ui/icons.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { CloneGithubDialog } from "./CloneGithubDialog.tsx";
import { QuickStartFlow } from "./CreateProjectDialog.tsx";

/**
 * The three ways to add a project, shared by this button and the new-workspace project menu: open a
 * folder, clone from GitHub, or quick start from a template. `dialogs` renders the clone and quick start
 * dialogs; place it once next to the menu that opens them.
 */
export function useAddProject() {
	const actions = useActions();
	const [busy, setBusy] = useState(false);
	const [cloneOpen, setCloneOpen] = useState(false);
	const [quickStartOpen, setQuickStartOpen] = useState(false);
	const flight = useRef(createSingleFlight()).current;

	// A second request while one runs gets the first one's promise, so the dialog opens once.
	const addProject = () =>
		flight.run("add-project", async () => {
			setBusy(true);
			try {
				const picked = await actions.app.pickFolder("Select project directory");
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
		});

	const dialogs = (
		<>
			{cloneOpen ? <CloneGithubDialog open onOpenChange={setCloneOpen} /> : null}
			<QuickStartFlow open={quickStartOpen} onOpenChange={setQuickStartOpen} />
		</>
	);

	return {
		busy,
		addProject,
		openClone: () => setCloneOpen(true),
		openQuickStart: () => setQuickStartOpen(true),
		dialogs,
	};
}

/** Open project, Open GitHub project and Quick start, in Conductor's order and words. */
export function AddProjectItems({ add }: { add: ReturnType<typeof useAddProject> }) {
	return (
		<>
			<MenuItem icon={<FolderIcon />} onSelect={() => void add.addProject()}>
				Open project
			</MenuItem>
			<MenuItem icon={<GlobeIcon />} onSelect={add.openClone}>
				Open GitHub project
			</MenuItem>
			<MenuItem icon={<FolderPlusIcon />} onSelect={add.openQuickStart}>
				Quick start
			</MenuItem>
		</>
	);
}

/**
 * The sidebar's add-project menu. It has no button of its own: it opens under the right end of the row
 * it sits in, when the "Add project" command runs (its shortcut, the palette, the list header menu).
 */
export function AddProjectMenu() {
	const add = useAddProject();
	const [open, setOpen] = useState(false);
	useCommandHandler("project.add", "area", () => {
		// The next frame, so a menu that ran the command has finished closing and keeps no focus trap.
		requestAnimationFrame(() => setOpen(true));
		return true;
	});
	return (
		<>
			<Menu open={open} onOpenChange={setOpen}>
				<MenuTrigger asChild>
					<span
						aria-hidden="true"
						tabIndex={-1}
						className="pointer-events-none absolute right-6 top-full size-0"
					/>
				</MenuTrigger>
				<MenuContent align="end" sideOffset={4} className="w-80" aria-label="Add project">
					<AddProjectItems add={add} />
				</MenuContent>
			</Menu>
			{add.dialogs}
		</>
	);
}

export function AddProjectButton({
	variant = "secondary",
	size = "md",
	className,
}: Pick<ButtonProps, "variant" | "size" | "className">) {
	const repos = useRepos();
	const add = useAddProject();
	const hasProjects = repos.state === "ready" && repos.data.length > 0;
	const label = variant === "default" && size === "lg" ? "Open project" : "Add a project";

	if (!hasProjects) {
		return (
			<Button
				variant={variant}
				size={size}
				loading={add.busy}
				className={className}
				onClick={() => void add.addProject()}
			>
				<FolderPlusIcon />
				{label}
			</Button>
		);
	}

	return (
		<>
			<Menu>
				<MenuTrigger asChild>
					<Button variant={variant} size={size} loading={add.busy} className={className}>
						<FolderPlusIcon />
						{label}
						<ChevronDownIcon />
					</Button>
				</MenuTrigger>
				<MenuContent align="start" className="w-80">
					<AddProjectItems add={add} />
				</MenuContent>
			</Menu>
			{add.dialogs}
		</>
	);
}
