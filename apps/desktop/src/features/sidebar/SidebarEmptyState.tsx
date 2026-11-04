/**
 * @feature APP-04 Sidebar empty states
 * Owns: the two empty states of the workspace list: no projects at all, and projects without workspaces.
 * Behaviour: ui-map.md 7.2 ("Repos: No repositories found, Add a project to get started."; "Sidebar new team:
 * Create your first workspace to start building with your team.").
 * Our design choice: with no project the add-project button is secondary, because the centre of the window
 * already carries the one primary "Add a project" action. With projects but no workspaces, "New workspace" is
 * a link to /create.
 * Must handle: the add action is not built yet (the button area alone shows <NotBuiltYet>); a narrow sidebar
 * (compact layout, text wraps).
 * Test first: kind="no-projects" renders "No projects yet"; kind="no-workspaces" renders a link to /create.
 */
import { Link } from "@tanstack/react-router";
import { buttonClassName } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { AddProjectButton } from "./AddProjectButton.tsx";

export function SidebarEmptyState({ kind }: { kind: "no-projects" | "no-workspaces" }) {
	if (kind === "no-projects") {
		return (
			<EmptyState
				compact
				title="No projects yet"
				body="Add a project to create your first workspace."
				action={
					<NotBuiltYet area="Add project" variant="inline">
						<AddProjectButton variant="secondary" size="sm" />
					</NotBuiltYet>
				}
			/>
		);
	}
	return (
		<EmptyState
			compact
			title="No workspaces yet"
			body="A workspace gives one task its own copy of the code and its own chats."
			action={
				<Link to="/create" className={buttonClassName({ variant: "secondary", size: "sm" })}>
					New workspace
				</Link>
			}
		/>
	);
}
