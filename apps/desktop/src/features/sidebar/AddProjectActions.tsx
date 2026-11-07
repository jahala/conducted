/**
 * @feature APP-04 Centre empty state
 * Owns: the three ways to add a project, shown together wherever the app has no project to work in:
 * Open project (the primary action), Open GitHub project and Quick start.
 * Behaviour: ui-map.md 2 (the add-project block), 7.2; Conductor's landing shows the same three cards
 * (renderApp @1718627).
 * Our design choice: one component, so the first screen and the Create page offer the same choices.
 * Must handle: a narrow window (the buttons wrap and stay centred).
 * Test first: CreateWorkspacePage.test.tsx, "offers the same three ways to add a project as the first
 * screen".
 */
import { AddProjectButton } from "./AddProjectButton.tsx";
import { CloneGithubButton } from "./CloneGithubDialog.tsx";
import { QuickStartButton } from "./CreateProjectDialog.tsx";

export function AddProjectActions() {
	return (
		<div className="flex flex-wrap items-center justify-center gap-2">
			<AddProjectButton variant="default" size="lg" />
			<CloneGithubButton size="lg" />
			<QuickStartButton size="lg" />
		</div>
	);
}
