/**
 * @feature WS-03 Setup script in a terminal, with workspace variables and copied files
 * Owns: the one gitignore-style glob rule shared by the workspace file-copy matcher and the
 * in-memory file system's gitignore reader, so both read `**` and `?` the same way.
 * Behaviour: services-map.md 3.1 and 5A.5.5 (file_include_globs, `.worktreeinclude`).
 * Our design choice: an anchored expression where `**` crosses folder boundaries, `*` stays
 * inside one segment and `?` matches one character that is not "/". As in gitignore, a `**`
 * segment followed by a slash stands for zero or more folders, so it also matches no folder: the
 * pattern for "a", any folders, "b" matches "a/b", and a leading one matches a top-level file.
 * Test first: "config/**" matches "config/nested/app.json" but "config/*.json" does not.
 */
export function globToRegExp(pattern: string): RegExp {
	let source = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern.charAt(index);
		if (char === "*") {
			if (pattern.charAt(index + 1) === "*") {
				const atSegmentStart = index === 0 || pattern.charAt(index - 1) === "/";
				if (atSegmentStart && pattern.charAt(index + 2) === "/") {
					// `**/` is zero or more whole folders.
					source += "(?:.*/)?";
					index += 2;
				} else {
					source += ".*";
					index += 1;
				}
			} else {
				source += "[^/]*";
			}
		} else if (char === "?") {
			source += "[^/]";
		} else {
			source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
		}
	}
	return new RegExp(`${source}$`);
}
