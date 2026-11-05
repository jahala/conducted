/**
 * @feature RUN-01 Run empty state
 * Owns: the designed state of the Run tab when the repository has no actions.
 * Behaviour: ui-map.md 3.7, "Run" paragraph ("Run tests or a development server to test changes in
 * this workspace", "Add action", "Add action manually", "Configure actions").
 * Must handle: the agent route (ask the agent to create an action), the manual route, and no chat
 * to ask (the agent button is disabled).
 * Test first: the Add action button calls onAddAction.
 */
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";

export interface RunEmptyStateProps {
	canAskAgent: boolean;
	onAskAgent: () => void;
	onAddAction: () => void;
	onConfigure: () => void;
}

export function RunEmptyState({
	canAskAgent,
	onAskAgent,
	onAddAction,
	onConfigure,
}: RunEmptyStateProps) {
	return (
		<EmptyState
			title="Run tests or a development server"
			body="Run tests or a development server to test changes in this workspace."
			action={
				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button variant="outline" size="sm" disabled={!canAskAgent} onClick={onAskAgent}>
						Ask agent
					</Button>
					<Button variant="default" size="sm" onClick={onAddAction}>
						Add action
					</Button>
					<Button variant="outline" size="sm" onClick={onConfigure}>
						Add action manually
					</Button>
					<Button variant="ghost" size="sm" onClick={onConfigure}>
						Configure actions
					</Button>
				</div>
			}
		/>
	);
}
