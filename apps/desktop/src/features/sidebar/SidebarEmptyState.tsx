/**
 * @feature APP-04 Sidebar empty states
 * Owns: the two empty states of the workspace list: no projects at all, and projects without workspaces.
 * Behaviour: ui-map.md 7.2 ("Repos: No repositories found, Add a project to get started."; "Sidebar new team:
 * Create your first workspace to start building with your team.").
 * Our design choice: with no project the add-project button is secondary, because the centre of the window
 * already carries the one primary "Add a project" action. With projects but no workspaces, "New workspace" is
 * a link to /create.
 * Must handle: a narrow sidebar (compact layout, text wraps). A failure of the add button is caught by the
 * list region's boundary in <Sidebar>.
 * Test first: kind="no-projects" renders "No projects yet"; kind="no-workspaces" renders a link to /create.
 */
import { Link } from "@tanstack/react-router";
import { buttonClassName } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { AddProjectButton } from "./AddProjectButton.tsx";

export function SidebarEmptyState({ kind }: { kind: "no-projects" | "no-workspaces" }) {
	if (kind === "no-projects") {
		// Conductor's block at the top of the empty list (renderApp @10534600): one muted sentence. The
		// button below it is ours.
		return (
			<div className="flex w-full flex-col items-start gap-2 rounded-md px-3 py-2.5 text-sidebar-fg-muted">
				<h2 className="text-sm font-medium text-sidebar-fg">No projects yet</h2>
				<p className="text-sm">Add a project to get started.</p>
				<AddProjectButton variant="secondary" size="sm" />
			</div>
		);
	}
	return (
		<EmptyState
			compact
			title="No workspaces yet"
			body="Create your first workspace to start building."
			action={
				<Link to="/create" className={buttonClassName({ variant: "secondary", size: "sm" })}>
					New workspace
				</Link>
			}
		/>
	);
}
