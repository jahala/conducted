/**
 * The release's steps, in order, as the dry run lists them: what each does and how to undo it.
 * `scripts/release.ts` runs each one by its id. A step that changes nothing also runs in the dry
 * run, so the dry run says whether --go would stop.
 *
 * The local steps stop at the tag. Pushing it starts the release workflow, which builds, signs,
 * notarises, attests and publishes the app (PLAT-37, PLAT-38). The changelog step writes the
 * notes from the commits since the last tag (PLAT-39).
 */
import { VERSION_FILES } from "../guards/versions.ts";

export type ReleaseStepId = "check" | "bump" | "changelog" | "commit";

export interface PlannedStep {
	id: ReleaseStepId;
	say: string;
	undo: string;
	readOnly?: true;
}

export function releasePlan(version: string): readonly PlannedStep[] {
	return [
		{
			id: "check",
			say: "Check the tree is clean, on main at origin/main, and main's CI passed for it",
			undo: "nothing to undo",
			readOnly: true,
		},
		{
			id: "bump",
			say: `Set version ${version} in ${VERSION_FILES.join(", ")}`,
			undo: "git checkout -- <those files>",
		},
		{
			id: "changelog",
			say: `Write CHANGELOG.md's ${version} section from the commit subjects since the last tag, newest release first`,
			undo: "git checkout -- CHANGELOG.md",
		},
		{
			id: "commit",
			say: `Commit "release: v${version}" and tag v${version}`,
			undo: `git tag -d v${version} && git revert HEAD`,
		},
	];
}
