/**
 * @feature APP-04 Centre empty state
 * Owns: what the centre area shows when no workspace is open: the first screen of a new install and the
 * screen after the last workspace is closed.
 * Behaviour: ui-map.md 2 (route "/": logo and an add-project block), 7.2 (designed empty states such as
 * "Add a project to get started.").
 * Our design choice: poster logic. One large line, one sentence, one primary button. "Open project" is the
 * screen's single primary action and "Open GitHub project" sits beside it as a secondary action, so the
 * sidebar's own "Add a project" button is secondary too.
 * Must handle: the action's data call fails or is not built (the button area alone shows <NotBuiltYet>, the
 * rest of the screen stays); the window is narrow (text wraps, stays centred); the frame keeps a drag strip so
 * the empty window can still be moved.
 * Test first: renders the heading and a region for the add-project action.
 */
import { AddProjectButton } from "../features/sidebar/AddProjectButton.tsx";
import { CloneGithubButton } from "../features/sidebar/CloneGithubDialog.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import { FullPage } from "./FullPage.tsx";

export function NoWorkspaceSelected() {
	return (
		<FullPage>
			<EmptyState
				title="Run agents side by side"
				body="Add a project, then give each task its own workspace. Pick a workspace in the sidebar to continue where you left off."
				action={
					<NotBuiltYet area="Add project">
						<div className="flex flex-wrap items-center justify-center gap-2">
							<AddProjectButton variant="default" size="lg" />
							<CloneGithubButton size="lg" />
						</div>
					</NotBuiltYet>
				}
			/>
		</FullPage>
	);
}
