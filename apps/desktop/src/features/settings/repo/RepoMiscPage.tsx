/**
 * @feature SET-07 Repository Misc page
 * Owns: the per-repository Misc page: icon, locations, preview URLs, files to copy into new
 * workspaces, per-repository git overrides, and removing the repository.
 * Behaviour: ui-map.md 6, "Misc (repo)" table (Icon, Root path, Workspaces path, Preview URLs,
 * Files to copy, Remove repository) and "Git" table (rows with scope repository: branch new
 * workspaces from, remote origin, delete branch on archive, archive on merge, set upstream on plain
 * push). Files to copy is PRJ-04; the copy itself runs in the workspace service.
 * Data: useRepos (path, icon, default branch), useRepoConfig (copyFiles, previewUrlTemplate),
 * useActions().projects (updateConfig, remove).
 * Children: FilesToCopyField, RemoveRepoDialog.
 * Must handle: root path shown read-only with the warning not to move it, a preview URL template
 * with the workspace port variable (validated, see run/preview-urls.ts), files to copy as globs with
 * a live preview of matches, remote origin choices from `git remote`, and removal that also removes
 * workspaces (confirm with the count).
 * Test first: removing a repository with two workspaces asks for confirmation naming the count.
 */
import type { RepoId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function RepoMiscPage(_props: { repoId: RepoId }): never {
	return notImplemented("SET-07");
}
