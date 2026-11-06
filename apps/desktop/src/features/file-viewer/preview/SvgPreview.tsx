/**
 * @feature REV-08 SVG preview
 * Owns: showing an SVG file either rendered or as its source, with a switch.
 * Behaviour: ui-map.md 3.2 (SVG: "View raw SVG code", "View rendered SVG").
 * Our design choice: the drawing is loaded through an img element from a data URL, so embedded
 * scripts never run in the page.
 * Must handle: invalid SVG (show the source and an error note), very large SVG, and the switch
 * being controlled by the parent so it can remember the choice.
 * Test first: an SVG with a script element renders without executing it.
 */
import { useMemo, useState } from "react";
import { Button } from "../../../ui/Button.tsx";

export interface SvgPreviewProps {
	source: string;
	view: "rendered" | "source";
	onViewChange: (view: "rendered" | "source") => void;
}

export function SvgPreview({ source, view, onViewChange }: SvgPreviewProps) {
	const [failed, setFailed] = useState(false);
	const dataUrl = useMemo(
		() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
		[source],
	);

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex items-center justify-end gap-1 border-b border-border px-2 py-1">
				<Button
					variant={view === "rendered" ? "secondary" : "ghost"}
					size="xs"
					aria-pressed={view === "rendered"}
					onClick={() => onViewChange("rendered")}
				>
					View rendered SVG
				</Button>
				<Button
					variant={view === "source" ? "secondary" : "ghost"}
					size="xs"
					aria-pressed={view === "source"}
					onClick={() => onViewChange("source")}
				>
					View raw SVG code
				</Button>
			</div>
			{view === "source" ? (
				<pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-code text-fg">
					<code>{source}</code>
				</pre>
			) : (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto p-4">
					{failed ? (
						<p role="note" className="text-sm text-fg-muted">
							This SVG could not be rendered. Its source is still available.
						</p>
					) : null}
					<img
						src={dataUrl}
						alt="SVG preview"
						className="max-h-full max-w-full"
						onError={() => setFailed(true)}
					/>
				</div>
			)}
		</div>
	);
}
