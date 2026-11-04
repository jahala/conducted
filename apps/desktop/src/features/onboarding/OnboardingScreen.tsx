/**
 * @feature APP-02 First-run onboarding
 * Owns: The first-run screen: a short welcome, a check of which agents are installed, and adding
 * the first project.
 * Behaviour: ui-map.md 7.1 (first run at /first-run-onboarding: three selectable steps with title
 * and text, 'Exit onboarding' top right, 'Continue' (Enter), down arrow cycles; on finish it stores
 * the onboarding state and goes to '/'; error 'Couldn't finish setup. Please try again.').
 * Our design choice: Conductor plays three videos and asks for sign-in. We have neither videos nor
 * sign-in. Our steps: 1 what the app does, 2 which agents were found and how to sign in, 3 add a
 * project. The accent is on Continue only.
 * Must handle: Exit at any step (the state is stored so it is not shown again); no agent found
 * (explain how to install one, the user may continue); a project already exists (skip step 3);
 * finishing fails (toast, stay on the step); Enter continues, arrow keys move between steps; the
 * window title area is draggable.
 * Test first: Exiting stores the onboarding state and navigates to '/'; Continue advances one step.
 */
import { notImplemented } from "@conducted/shared";

export function OnboardingScreen(_props: Record<string, never>): never {
	return notImplemented("APP-02");
}
