/**
 * @feature PRJ-05 Repository icon
 * Owns: reading a repository's saved icon value as the avatar source the sidebar and the Misc page
 * draw: an emoji or symbol, an uploaded image, a site favicon, a GitHub owner avatar, or the
 * repository's first letter.
 * Behaviour: ui-map.md 4 (workspace row repo avatar: emoji, uploaded icon, favicon, owner avatar or
 * letter), 5.2 (the icon picker's sources), 5.3 ("Change repository icon").
 * Must handle: a missing icon with no remote (letter); a GitHub remote (owner avatar); any other
 * remote (its favicon); an upload path kept in app storage; a value with no known prefix (no icon:
 * the fallbacks apply). "Use favicon" in the picker clears the icon, so the favicon is a fallback,
 * never a saved value.
 * Test first: a GitHub remote without a saved icon gives its owner avatar, and another remote gives
 * its favicon.
 */
import type { Repo } from "../../core/model.ts";

export const EMOJI_PREFIX = "emoji:";
export const FILE_PREFIX = "file:";

export type RepoIconSource =
	| { kind: "emoji"; emoji: string }
	| { kind: "file"; path: string }
	| { kind: "favicon"; url: string }
	| { kind: "owner"; url: string }
	| { kind: "letter"; letter: string };

export interface RemoteLocation {
	host: string;
	path: string;
}

/** Splits a remote URL into its host and path. Handles the HTTPS and `user@host:path` forms. */
export function remoteLocation(remoteUrl: string | null): RemoteLocation | null {
	const trimmed = remoteUrl?.trim() ?? "";
	if (trimmed === "") return null;
	const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(trimmed);
	if (scp !== null) {
		return { host: (scp[1] ?? "").toLowerCase(), path: scp[2] ?? "" };
	}
	try {
		const url = new URL(trimmed);
		if (url.hostname === "") return null;
		return { host: url.hostname.toLowerCase(), path: url.pathname };
	} catch {
		return null;
	}
}

/** The GitHub owner named by a remote, or null for another host or a malformed URL. */
export function githubOwnerOf(remoteUrl: string | null): string | null {
	const remote = remoteLocation(remoteUrl);
	if (remote === null) return null;
	if (remote.host !== "github.com" && remote.host !== "www.github.com") return null;
	const owner = remote.path.split("/").filter((part) => part !== "")[0];
	return owner === undefined || owner === "" ? null : owner.replace(/\.git$/i, "");
}

/** The favicon URL of a remote's host, or null when the remote cannot name a host. */
export function faviconUrlOf(remoteUrl: string | null): string | null {
	const remote = remoteLocation(remoteUrl);
	return remote === null ? null : `https://${remote.host}/favicon.ico`;
}

/** The stored value for a picked emoji or symbol. */
export const emojiIconValue = (emoji: string): string => `${EMOJI_PREFIX}${emoji}`;

/** The stored value for an uploaded image copied into app storage. */
export const fileIconValue = (path: string): string => `${FILE_PREFIX}${path}`;

/** The path of an uploaded icon, or null when the value is not one. */
export function fileIconPath(value: string | null): string | null {
	return value !== null && value.startsWith(FILE_PREFIX) ? value.slice(FILE_PREFIX.length) : null;
}

/** The avatar source for a repository, in the order the research gives the fallbacks. */
export function repoIconSource(repo: Pick<Repo, "icon" | "name" | "remoteUrl">): RepoIconSource {
	const saved = repo.icon?.trim() ?? "";
	if (saved.startsWith(FILE_PREFIX)) {
		return { kind: "file", path: saved.slice(FILE_PREFIX.length) };
	}
	if (saved.startsWith(EMOJI_PREFIX)) {
		const emoji = saved.slice(EMOJI_PREFIX.length).trim();
		if (emoji !== "") return { kind: "emoji", emoji };
	}

	const owner = githubOwnerOf(repo.remoteUrl);
	if (owner !== null) {
		return {
			kind: "owner",
			url: `https://github.com/${encodeURIComponent(owner)}.png?size=64`,
		};
	}
	const favicon = faviconUrlOf(repo.remoteUrl);
	if (favicon !== null) return { kind: "favicon", url: favicon };
	return { kind: "letter", letter: repoLetter(repo.name) };
}

/** The repository's first letter, the last fallback and what a failed image shows instead. */
export function repoLetter(name: string): string {
	const first = [...name.trim()][0];
	return first === undefined ? "?" : first.toUpperCase();
}
