/**
 * @feature NAV-03 Project avatar
 * Owns: the project's 16px mark in the sidebar: its icon when it has one, else its first letter.
 * Behaviour: ui-map.md 4 (rows and project groups show the project's avatar).
 * Must handle: a project with no icon and an empty name ("?").
 * Test first: not applicable; the sidebar row tests render it.
 */
import type { Repo } from "../../core/model.ts";

/** The project's mark: its icon, else its first letter, in a 16px box. */
export function RepoAvatar({ repo }: { repo: Repo }) {
	const icon = repo.icon?.trim();
	const text =
		icon !== undefined && icon !== "" ? icon : repo.name.slice(0, 1).toUpperCase() || "?";
	return (
		<span
			aria-hidden="true"
			className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-hover text-3xs font-medium text-sidebar-fg-muted"
		>
			{text}
		</span>
	);
}
