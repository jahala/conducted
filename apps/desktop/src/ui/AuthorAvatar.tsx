/**
 * @feature REV-13 Author avatar
 * Owns: a small round author picture, with a letter when the author has none or the picture fails.
 * Behaviour: services-map.md 3.7.4 and 5A.7.3 (a GitHub comment keeps its author's avatar); ui-map.md
 * 3.2 (activity and comments in the PR tab).
 * Our design choice: one avatar for every place that names an author, so the fallback cannot drift.
 * Must handle: no avatar URL (a letter on a neutral circle); an avatar that fails to load (the same
 * letter); a login that is empty (a question mark).
 * Test first: an author with no avatar shows the first letter of the login.
 */
import { useState } from "react";

export interface AuthorAvatarProps {
	login: string;
	avatarUrl: string | null;
}

export function AuthorAvatar({ login, avatarUrl }: AuthorAvatarProps) {
	const [failed, setFailed] = useState(false);
	const letter = login.trim().slice(0, 1).toUpperCase() || "?";
	if (avatarUrl !== null && !failed) {
		return (
			<img
				src={avatarUrl}
				alt=""
				className="size-4 shrink-0 rounded-full bg-muted"
				onError={() => setFailed(true)}
			/>
		);
	}
	return (
		<span
			aria-hidden="true"
			className="flex size-4 shrink-0 items-center justify-center rounded-full bg-hover text-3xs font-medium text-fg-muted"
		>
			{letter}
		</span>
	);
}
