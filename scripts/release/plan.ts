/**
 * The release's steps, in order, as the dry run lists them: what each does and how to undo it.
 * `scripts/release.ts` runs each one by its id. A step that changes nothing also runs in the dry
 * run, so the dry run says whether --go would stop.
 *
 * The updater steps (PLAT-13, D079): `tauri build` makes an update archive from the app it built,
 * before the release signs and notarises it, so that archive is replaced by one made from the
 * signed, notarised app and signed again with the updater key. Then `latest.json` is written
 * beside the disk image.
 */
import { VERSION_FILES } from "../guards/versions.ts";

export type ReleaseStepId =
	| "check"
	| "bump"
	| "build"
	| "updaterArchive"
	| "updaterFeed"
	| "commit";

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
			id: "build",
			say: "Read the updater key from the keychain into the build's environment, install the locked packages, build the arm64 app alone, sign and notarise it, then make and verify the disk image",
			undo: "git checkout -- . (drops the version bump); build output stays under apps/desktop/src-tauri/target",
		},
		{
			id: "updaterArchive",
			say: "Make the update archive (Conducted.app.tar.gz) again from the signed, notarised app, and sign it with the updater key",
			undo: "trash the archive and its .sig under apps/desktop/src-tauri/target; nothing else changes",
		},
		{
			id: "updaterFeed",
			say: `Write latest.json for v${version} beside the disk image, pointing at the release's archive`,
			undo: "trash latest.json under apps/desktop/src-tauri/target; nothing else changes",
		},
		{
			id: "commit",
			say: `Commit "release: v${version}" and tag v${version}`,
			undo: `git tag -d v${version} && git revert HEAD`,
		},
	];
}
