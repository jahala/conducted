/**
 * @feature NAV-03 Project avatar
 * Owns: the project's 16px mark in a project group's header. It draws the same source as PRJ-05's
 * RepoIconAvatar (emoji, uploaded icon, favicon, owner avatar or letter) through RepoIconMark, but
 * stays decorative: the header is itself a button, so the mark carries no menu and no name.
 * Behaviour: ui-map.md 4 (rows and project groups show the project's avatar).
 * Must handle: a project with no icon and an empty name ("?"); an image that fails to load (the letter).
 * Test first: not applicable; the sidebar group tests render it.
 */
import type { Repo } from "../../core/model.ts";
import { RepoIconMark } from "./RepoIcon.tsx";

/** The project's mark in a 16px box, drawn from its icon source. */
export function RepoAvatar({ repo }: { repo: Repo }) {
	return (
		<span
			aria-hidden="true"
			className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-hover text-3xs font-medium text-sidebar-fg-muted"
		>
			<RepoIconMark repo={repo} />
		</span>
	);
}
