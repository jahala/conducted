/**
 * @feature APP-04 Sidebar empty states
 * Owns: the two empty states of the workspace list: no projects at all, and projects without workspaces.
 * Behaviour: ui-map.md 7.2 ("Repos: No repositories found, Add a project to get started."; "Sidebar new team:
 * Create your first workspace to start building with your team.").
 * With no project, the list shows Conductor's one muted sentence and nothing else (renderApp @10534600):
 * the centre of the window carries the add-project actions (D098).
 * Our design choice: with projects but no workspaces, "New workspace" is a link to /create.
 * Must handle: a narrow sidebar (compact layout, text wraps).
 * Test first: kind="no-projects" renders "Add a project to get started."; kind="no-workspaces" renders a
 * link to /create.
 */
import { Link } from "@tanstack/react-router";
import { buttonClassName } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";

export function SidebarEmptyState({ kind }: { kind: "no-projects" | "no-workspaces" }) {
	if (kind === "no-projects") {
		// Conductor's block at the top of the empty list (renderApp @10534600): one muted sentence.
		return (
			<div className="flex w-full flex-col rounded-md px-1.5 py-2.5 text-sidebar-fg-muted">
				<p className="text-sm">Add a project to get started.</p>
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
