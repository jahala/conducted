/**
 * @feature WS-03 Setup empty state
 * Owns: the designed state of the Setup tab when the repository has no setup script, and the one
 * for a script that has not run yet.
 * Behaviour: ui-map.md 3.7, "Setup" paragraph ("Add setup script" with "Ask agent" or "Add
 * manually"; text about running commands when a workspace is created to install dependencies; the
 * empty output text).
 * Must handle: "Ask agent" being disabled on an archived workspace, and "Add manually" opening the
 * repository settings pages.
 * Test first: with no script, both actions show; with a script that has not run, neither does.
 */
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";

export interface SetupEmptyStateProps {
	hasScript: boolean;
	canAskAgent: boolean;
	onAskAgent: () => void;
	onAddManually: () => void;
}

export function SetupEmptyState({
	hasScript,
	canAskAgent,
	onAskAgent,
	onAddManually,
}: SetupEmptyStateProps) {
	if (hasScript) return null;

	return (
		<EmptyState
			title="Add setup script"
			body="Run commands when a workspace is created to install dependencies or set up the environment."
			action={
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" disabled={!canAskAgent} onClick={onAskAgent}>
						Ask agent
					</Button>
					<Button variant="default" size="sm" onClick={onAddManually}>
						Add manually
					</Button>
				</div>
			}
		/>
	);
}
