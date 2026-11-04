/**
 * @feature SET-04 Environment files list
 * Owns: the list of files in the repository that hold more variables, to be loaded into new
 * workspaces' scripts.
 * Behaviour: ui-map.md 6, "Environment page" (env files list, "Cancel adding env file");
 * services-map.md 4.2.3 (environment_variable_files).
 * Must handle: no files, a file that does not exist (marked), a path outside the repository
 * (refused), adding by picking from a list of dotenv-style files found in the repository, and
 * removing an entry without touching the file.
 * Test first: adding a path outside the repository root is refused.
 */
import { notImplemented } from "@conducted/shared";

export interface EnvFilesListProps {
	files: { path: string; exists: boolean }[];
	candidates: string[];
	onAdd: (path: string) => Promise<boolean>;
	onRemove: (path: string) => Promise<boolean>;
}

export function EnvFilesList(_props: EnvFilesListProps): never {
	return notImplemented("SET-04");
}
