/**
 * @feature APP-04 Centre empty state
 * Owns: what the centre area shows when no workspace is open: the first screen of a new install and the
 * screen after the last workspace is closed.
 * Behaviour: ui-map.md 2 (route "/": logo and an add-project block), 7.2 (designed empty states such as
 * "Add a project to get started.").
 * Our design choice: poster logic. One large line, one sentence, one accent button. The button is the screen's
 * single primary action, so the sidebar's own "Add a project" button is secondary.
 * Must handle: the action's data call fails or is not built (the button area alone shows <NotBuiltYet>, the
 * rest of the screen stays); the window is narrow (text wraps, stays centred); a drag strip so the empty window
 * can still be moved.
 * Test first: renders the heading and a region for the add-project action.
 */
import { AddProjectButton } from "../features/sidebar/AddProjectButton.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";

export function NoWorkspaceSelected() {
	return (
		<div className="flex h-full flex-col">
			<div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
			<div className="min-h-0 flex-1">
				<EmptyState
					title="Run agents side by side"
					body="Add a project, then give each task its own workspace. Pick a workspace in the sidebar to continue where you left off."
					action={
						<NotBuiltYet area="Add project">
							<AddProjectButton variant="primary" size="lg" />
						</NotBuiltYet>
					}
				/>
			</div>
		</div>
	);
}
