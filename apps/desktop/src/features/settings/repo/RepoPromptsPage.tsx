/**
 * @feature SET-07 Repository Prompts page
 * Owns: the per-repository Prompts page: custom instructions added to the agent's task for the
 * Review, Create PR, Fix errors, Resolve conflicts and Rename branch buttons, and general
 * instructions for every new chat.
 * Behaviour: ui-map.md 6, "Actions page" (prompts for Review, Create PR, Fix errors, Resolve
 * conflicts; each "Add custom instructions sent to the agent when you click the X button"; "General
 * preferences") and "Actions (repo)" table; services-map.md 3.7.6 and 4.2.3 (custom_prompt_*).
 * Data: useRepoConfig(repoId).prompts, useActions().projects.updateConfig. Also the review model
 * (DefaultModelsPage owns it).
 * Rows (our wording), RepoConfig.prompts field:
 *   General instructions          general
 *   Review                        codeReview
 *   Create PR                     createPr
 *   Fix errors                    fixErrors
 *   Resolve conflicts             resolveConflicts
 *   Rename branch                 renameBranch
 * Must handle: an empty field meaning "use only the built-in instructions" (shown as a hint, not
 * stored as an empty string), very long text (warning above 4,000 characters, Our design choice),
 * save on blur, a failed save, and a reset per field.
 * Test first: clearing the Review field stores null, not an empty string.
 */
import type { RepoId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function RepoPromptsPage(_props: { repoId: RepoId }): never {
	return notImplemented("SET-07");
}
