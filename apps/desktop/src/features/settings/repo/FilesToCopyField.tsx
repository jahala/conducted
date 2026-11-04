/**
 * @feature SET-07 Files to copy field
 * Owns: the editor for the list of file paths or patterns copied from the main clone into each new
 * workspace, with a preview of what matches.
 * Behaviour: ui-map.md 6, "Misc (repo)" (Files to copy) and "Environment page" ("Detecting files to
 * copy...", "Using .worktreeinclude from this repository..."); services-map.md 4.2.3
 * (file_include_globs); scaffold backlog PRJ-04.
 * Must handle: a pattern with no match (shown, not an error), a pattern that reaches outside the
 * repository (refused), a huge match list (first 50 and a count), detection in progress, and a
 * `.worktreeinclude` file taking over (the field says where the list comes from, read-only).
 * Test first: the pattern "../secret" is refused.
 */
import { notImplemented } from "@conducted/shared";

export interface FilesToCopyFieldProps {
	patterns: string[];
	matches: { state: "detecting" } | { state: "ready"; paths: string[] };
	source: "settings" | "worktreeinclude";
	onChange: (patterns: string[]) => void;
}

export function FilesToCopyField(_props: FilesToCopyFieldProps): never {
	return notImplemented("SET-07");
}
