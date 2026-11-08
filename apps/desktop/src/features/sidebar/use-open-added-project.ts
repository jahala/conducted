/**
 * @feature PRJ-01 Add a project
 * Owns: what happens once a project is added (opened from a folder, cloned, or made by Quick start):
 * its first workspace is created with the user's default chat settings and opened.
 * Behaviour: Conductor's repo-created step (renderApp @1713146, `autoCreateWorkspace`) creates the
 * new project's first workspace and navigates to it; a failure shows "Failed to create workspace".
 * The new-workspace page keeps the project in its picker instead (Conductor's other branch there).
 * Must handle: the workspace cannot be made (a toast; the project stays added).
 * Test first: router.nav-02.test.tsx, "Open project: picks the folder, adds it, then opens a new
 * workspace in it".
 */
import { useNavigate } from "@tanstack/react-router";
import { useActions } from "../../core/hooks.ts";
import type { Repo } from "../../core/model.ts";
import { toastError } from "../../ui/Toast.tsx";

/** Creates a just-added project's first workspace and opens it. */
export function useOpenAddedProject(): (repo: Repo) => Promise<void> {
	const actions = useActions();
	const navigate = useNavigate();
	return async (repo) => {
		const created = await actions.workspaces.createFirst(repo.id);
		if (!created.ok) {
			toastError("Failed to create workspace", created.error);
			return;
		}
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: repo.id, workspaceId: created.value.id },
		});
	};
}
