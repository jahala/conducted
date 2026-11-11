/**
 * @feature RUN-02 Spotlight testing
 * Owns: the id and the notice text of the synthetic Spotlight run entry, which the Run tab and the
 * Spotlight service share.
 * Behaviour: services-map.md 5A.2.1 (the Spotlight entry), 5A.2.5 (the branch pointer notice).
 */

/** The id of the synthetic Spotlight entry in the run list (services-map.md 5A.2.1). */
export const SPOTLIGHT_ACTION_ID = "spotlight";

/** Shown in the Run tab while Spotlight runs (services-map.md 5A.2.5, the moved branch pointer). */
export const SPOTLIGHT_BRANCH_NOTICE =
	"Spotlight is running. Until you stop it, the repository root's branch points at this workspace's latest changes.";
