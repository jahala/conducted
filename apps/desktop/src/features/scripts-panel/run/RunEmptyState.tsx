/**
 * @feature RUN-01 Run empty state
 * Owns: the designed state of the Run tab when the repository has no actions.
 * Behaviour: ui-map.md 3.7, "Run" paragraph ("Run tests or a development server to test changes in
 * this workspace", "Add action", "Add action manually", "Configure actions").
 * Must handle: the agent route (ask the agent to create an action) and the manual route (opens
 * AddActionDialog), shared actions read-only, and Spotlight setting on with no actions.
 * Test first: the Add action button calls onAddAction.
 */
import { notImplemented } from "@conducted/shared";

export interface RunEmptyStateProps {
	canAskAgent: boolean;
	onAskAgent: () => void;
	onAddAction: () => void;
	onConfigure: () => void;
}

export function RunEmptyState(_props: RunEmptyStateProps): never {
	return notImplemented("RUN-01");
}
