/**
 * @feature WS-01 Create-workspace page
 * Owns: the full-page "new workspace" flow at /create: repository picker, "create from" (default branch, branch,
 * pull request, issue), target branch, first message editor with model picker and plan mode, attachments,
 * section picker, and the "Create workspace" button.
 * Behaviour: ui-map.md 3.9 (New workspace flow; "Draft the first message, then create and send it.").
 * Our design choice: this placeholder lives in app/ only because no worker owns a features/create-workspace
 * folder yet. It should move there, and reuse the composer editor from features/composer.
 * Must handle: no project yet (point to "Add a project"); a failed create keeps the draft ("Recover prompt");
 * creating shows progress and then opens the new workspace; an empty prompt creates the workspace without a chat.
 * Test first: submitting with a repository and a prompt calls workspaces.create with that input and navigates to
 * the new workspace.
 */
import { notImplemented } from "@conducted/shared";

export function CreateWorkspacePage(_props: Record<string, never>): never {
	return notImplemented("WS-01");
}
