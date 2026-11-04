/**
 * @feature PRJ-01 Add project button
 * Owns: the button that adds a project: ask for a folder (app.pickFolder), call projects.addLocal, show the outcome.
 * Behaviour: ui-map.md 3.9 and 4 item 8 ("Add project...", "Open project"), 7.2 ("Add a project to get started.").
 * Our design choice: one button for the local-folder path. Cloning from GitHub (PRJ-02) and quick start
 * (PRJ-03) join it as a menu once those services exist.
 * Must handle: the user cancels the folder dialog (no message, no change); the dialog fails (a toast); the folder is not a git repository or
 * is already added (the action returns an error, shown as a toast with its plain-language message); a second
 * click while one add is running does nothing; the button shows progress while working.
 * Test first: with a stand-in action that returns ok, clicking calls projects.addLocal with the picked folder.
 */
import { useState } from "react";
import { useActions } from "../../core/hooks.ts";
import { Button, type ButtonProps } from "../../ui/Button.tsx";
import { FolderPlusIcon } from "../../ui/icons.tsx";
import { toast } from "../../ui/Toast.tsx";

export function AddProjectButton({
	variant = "secondary",
	size = "md",
	className,
}: Pick<ButtonProps, "variant" | "size" | "className">) {
	const actions = useActions();
	const [busy, setBusy] = useState(false);

	const addProject = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const picked = await actions.app.pickFolder("Add a project");
			if (!picked.ok) {
				toast.error("Couldn't open the folder dialog", { description: picked.error.message });
				return;
			}
			if (picked.value === null) return;
			const result = await actions.projects.addLocal(picked.value);
			if (!result.ok)
				toast.error("Couldn't add the project", { description: result.error.message });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Button variant={variant} size={size} loading={busy} className={className} onClick={addProject}>
			<FolderPlusIcon />
			Add a project
		</Button>
	);
}
