/**
 * @feature WS-03 Setup empty state
 * Owns: the designed state of the Setup tab when the repository has no setup script, and the one
 * for a script that has not run yet.
 * Behaviour: ui-map.md 3.7, "Setup" paragraph ("Add setup script" with "Ask agent" or "Add
 * manually"; text about running commands when a workspace is created to install dependencies; the
 * empty output text).
 * Must handle: "Ask agent" being disabled without a chat, "Add manually" opening the repository
 * Scripts settings page, and a shared script file that is read-only.
 * Test first: with no script, both actions show; with a script that has not run, neither does.
 */
import { notImplemented } from "@conducted/shared";

export interface SetupEmptyStateProps {
	hasScript: boolean;
	canAskAgent: boolean;
	onAskAgent: () => void;
	onAddManually: () => void;
}

export function SetupEmptyState(_props: SetupEmptyStateProps): never {
	return notImplemented("WS-03");
}
