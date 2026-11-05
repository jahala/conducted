/**
 * @feature PLAT-33 Platform doors for dropped files, attachments and menu shortcuts
 * Owns: the window-level drop target that shows while a file drag is over the app.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A4 (drag enter, drag over, drop
 * and drag leave arrive from the window) and ui-map.md 3.5 (a file can be dropped to attach it).
 * Must handle: enter or over shows the target; drop or leave hides it; unmounting removes the
 * window listener.
 * Moved: copying the dropped files into app storage belongs to COMP-07; this component only
 * shows that the window accepts a drop.
 * Test first: an enter event shows "Drop files to attach" and a leave event hides it.
 */

import { useEffect, useState } from "react";
import { useServices } from "../core/context.tsx";

export function FileDropTarget() {
	const { platform } = useServices();
	const [dragging, setDragging] = useState(false);

	useEffect(
		() =>
			platform.window.onFileDrop((event) => {
				setDragging(event.kind === "enter" || event.kind === "over");
			}),
		[platform],
	);

	if (!dragging) return null;
	return (
		<div
			role="status"
			aria-live="polite"
			className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-overlay p-8"
		>
			<div className="rounded-xl border-2 border-dashed border-accent bg-raised px-8 py-6 text-sm font-medium text-fg shadow-popover">
				Drop files to attach
			</div>
		</div>
	);
}
