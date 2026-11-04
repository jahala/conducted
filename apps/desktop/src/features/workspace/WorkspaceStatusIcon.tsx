/**
 * @feature NAV-03 Workspace status icon
 * Owns: the small icon at the start of a sidebar row, Home card and tab that shows the derived status.
 * Behaviour: ui-map.md 3.8 (row icon: unread dot, typing loader, waiting loader, setting-up loader, red alert,
 * or a branch glyph).
 * Our design choice: the icon follows the status tone. Active work shows a spinner, attention shows an accent
 * dot, danger shows an alert mark, everything else a quiet ring. The optional animated "status matrix" for
 * working local workspaces is left out.
 * Must handle: the icon is decorative, the status text beside it is the accessible name; an unknown status
 * (null) shows the quiet ring.
 * Test first: renders a status role for an active status and an aria-hidden mark otherwise.
 */
import type { WorkspaceStatus } from "../../core/model.ts";
import { Spinner } from "../../ui/Spinner.tsx";
import { statusText } from "./status-text.ts";

export function WorkspaceStatusIcon({ status }: { status: WorkspaceStatus | null }) {
	const { text, tone } = statusText(status);
	switch (tone) {
		case "active":
			return <Spinner label={text} size="sm" className="text-fg-muted" />;
		case "attention":
			return <span aria-hidden="true" className="size-2 rounded-full bg-accent" />;
		case "danger":
			return (
				<span
					aria-hidden="true"
					className="flex size-3.5 items-center justify-center rounded-full bg-danger-solid text-xs font-semibold leading-none text-on-danger"
				>
					!
				</span>
			);
		case "success":
			return <span aria-hidden="true" className="size-2 rounded-full bg-success" />;
		case "neutral":
			return <span aria-hidden="true" className="size-2 rounded-full border border-fg-subtle" />;
	}
}
