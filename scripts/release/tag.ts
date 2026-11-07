/**
 * Reads the release tag and checks it against every version file (PLAT-37). The workflow reads the
 * same list of files the version guard reads, so a tag can never publish a build whose files
 * disagree. A suffix after the patch number makes the release a pre-release: the dry run.
 */

/** A release tag: `v<major>.<minor>.<patch>`, optionally followed by `-<pre-release>`. */
export interface TagVersion {
	tag: string;
	/** The version every version file must hold: the base without the pre-release suffix. */
	version: string;
	prerelease: boolean;
}

const TAG = /^v(\d+\.\d+\.\d+)(-[0-9A-Za-z.-]+)?$/;

export function readTag(tag: string): TagVersion | null {
	const match = TAG.exec(tag);
	const base = match?.[1];
	if (base === undefined) return null;
	return { tag, version: base, prerelease: match?.[2] !== undefined };
}

/**
 * Every version file that disagrees with the tag, named. An unreadable tag is one problem.
 * `versions` pairs each file with its version, or null when the file cannot be read.
 */
export function tagProblems(
	tag: string,
	versions: readonly (readonly [string, string | null])[],
): string[] {
	const release = readTag(tag);
	if (release === null) {
		return [`The tag ${tag} is not v<major>.<minor>.<patch> or v<version>-<pre-release>.`];
	}
	return versions
		.filter(([, version]) => version !== release.version)
		.map(([file, version]) =>
			version === null
				? `${file} has no version, but the tag ${tag} names ${release.version}.`
				: `${file} has version ${version}, but the tag ${tag} names ${release.version}.`,
		);
}
