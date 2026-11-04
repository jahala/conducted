/**
 * @feature APP-02 Onboarding: first project
 * Owns: The step where the user adds a first project from a folder.
 * Behaviour: ui-map.md 3.9 and 7.1 (add a project), 7.2 ('Add a project to get started.').
 * Must handle: Cancelled folder dialog; a folder that is not a git repository (message from the
 * action); adding succeeds (finish onboarding and open the empty workspace state); skipping is
 * allowed.
 * Test first: Adding a folder calls projects.addLocal and then finishes onboarding.
 */
import { notImplemented } from "@conducted/shared";

export interface ProjectStepProps {
	onFinish: () => void;
}

export function ProjectStep(_props: ProjectStepProps): never {
	return notImplemented("APP-02");
}
