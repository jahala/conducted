/**
 * @feature CHAT-24 Mermaid diagrams in replies
 * Owns: drawing a fenced `mermaid` code block as a diagram, with "Rendering diagram...", "Expand diagram",
 * "Copy Mermaid source", zoom in, zoom out and reset, and "Failed to render diagram" when it cannot
 * be drawn (renderApp @8047788).
 * Behaviour: ui-map.md 3.3 (Assistant text: Mermaid with those labels), 8 (Conductor uses the Mermaid
 * library, among its dependencies).
 * Dependency: mermaid 12.3.0, MIT, checked 2026-11-06. It is loaded on first use, so the chat does not pay
 * for it at startup.
 * Our design choice: the SVG is drawn only after the source has stopped changing for a moment, so a diagram
 * that is still streaming keeps its last drawing instead of flashing a parse error. The app's light or dark
 * theme picks the Mermaid theme.
 * Must handle: source that is still streaming (keep the last diagram that rendered, redraw after the text
 * stops changing; never show a parse error for half a diagram); source that does not parse, or a Mermaid
 * library that fails to load (Conductor's "Failed to render diagram" in its error colour, never a stack
 * trace; the log says which of the two failed and why); the app theme changing (redraw in the new theme);
 * a very large diagram (the expanded view scrolls and zooms from the top left corner, so scrolling reaches
 * every edge; zoom limits at both ends, "Reset" returns to fit); script, links and click handlers in the
 * diagram (strict security level, the SVG is sanitised and removed of scripts and event handlers before it
 * is inserted); two diagrams in one reply (unique element ids); "Copy Mermaid source" copies the exact
 * source text; the expanded view closes with Escape and returns focus through the shared Dialog.
 * Test first: says Failed to render diagram, as Conductor does, when the source does not parse.
 */
import { messageOf } from "@conducted/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { useThemeType } from "../../ui/use-theme-type.ts";

export interface MermaidDiagramProps {
	/** The text inside the fence. */
	source: string;
	/** The text is still arriving from the agent. */
	streaming: boolean;
}

/** How long the source must stay unchanged before it is drawn. */
const SETTLE_MS = 250;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

type MermaidApi = typeof import("mermaid").default;

interface Drawn {
	source: string;
	svg: string;
	theme: "light" | "dark";
}

const clampZoom = (value: number): number =>
	Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));

/** Removes the ways an SVG could run code or load a script from the diagram's own markup. */
function sanitizeSvg(svg: string): string {
	const document = new DOMParser().parseFromString(svg, "image/svg+xml");
	const root = document.documentElement;
	if (root === null || root.nodeName === "parsererror") return "";
	for (const node of root.querySelectorAll("script, foreignObject")) node.remove();
	const walk = (element: Element): void => {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim().toLowerCase();
			const isHandler = name.startsWith("on");
			const isScriptLink =
				(name === "href" || name === "xlink:href") && value.startsWith("javascript:");
			if (isHandler || isScriptLink) element.removeAttribute(attribute.name);
		}
		for (const child of element.children) walk(child);
	};
	walk(root);
	return new XMLSerializer().serializeToString(root);
}

/** Inserts an SVG that sanitizeSvg has already cleaned of scripts and event handlers. */
function SanitizedSvg({ svg }: { svg: string }) {
	// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeSvg removes scripts and event handlers first.
	return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function MermaidDiagram({ source, streaming }: MermaidDiagramProps) {
	const actions = useActions();
	const { platform } = useServices();
	const theme = useThemeType();
	const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
	const id = `mermaid-${reactId}`;
	const [drawn, setDrawn] = useState<Drawn | null>(null);
	const [failedSource, setFailedSource] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [zoom, setZoom] = useState(1);
	const drawnSource = drawn?.source ?? null;
	const drawnTheme = drawn?.theme ?? null;
	const latest = useRef(source);
	const attempt = useRef(0);
	latest.current = source;

	useEffect(() => {
		if (streaming) return;
		if (drawnSource === source && drawnTheme === theme) return;
		setFailedSource(null);
		let cancelled = false;
		const timer = setTimeout(() => {
			const fail = (message: string): void => {
				if (cancelled || latest.current !== source) return;
				platform.app.writeLog("warn", message);
				setDrawn(null);
				setFailedSource(source);
			};
			void (async () => {
				let mermaid: MermaidApi;
				try {
					mermaid = (await import("mermaid")).default;
				} catch (cause) {
					fail(`The Mermaid library could not be loaded: ${messageOf(cause)}`);
					return;
				}
				try {
					mermaid.initialize({
						startOnLoad: false,
						securityLevel: "strict",
						theme: theme === "dark" ? "dark" : "default",
					});
					attempt.current += 1;
					const rendered = await mermaid.render(`${id}-${attempt.current}`, source);
					const svg = sanitizeSvg(rendered.svg);
					if (svg.length === 0) throw new Error("The diagram's SVG could not be read.");
					if (cancelled || latest.current !== source) return;
					setDrawn({ source, svg, theme });
				} catch (cause) {
					fail(`The Mermaid diagram could not be drawn: ${messageOf(cause)}`);
				}
			})();
		}, SETTLE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [source, streaming, theme, id, drawnSource, drawnTheme, platform]);

	if (failedSource === source) {
		return (
			<div className="my-3 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 text-xs text-danger">
				Failed to render diagram
			</div>
		);
	}

	if (drawn === null) {
		return (
			<div className="my-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
				Rendering diagram...
			</div>
		);
	}

	return (
		<div className="my-3 overflow-hidden rounded-lg border border-border bg-surface">
			<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
				<span className="text-2xs text-fg-muted">Mermaid diagram</span>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="xs"
						onClick={() => {
							setZoom(1);
							setExpanded(true);
						}}
					>
						Expand diagram
					</Button>
					<CopyButton
						text={source}
						onCopy={(text) => actions.app.copyText(text)}
						label="Copy Mermaid source"
						className="h-6 px-2 text-2xs"
					/>
				</div>
			</div>
			<div className="overflow-x-auto p-3 [&_svg]:h-auto [&_svg]:max-w-full">
				<SanitizedSvg svg={drawn.svg} />
			</div>
			<Dialog open={expanded} onOpenChange={setExpanded}>
				<DialogContent title="Diagram" size="4xl" letShortcutsThrough>
					<div className="flex items-center justify-end gap-1">
						<Button
							variant="outline"
							size="xs"
							onClick={() => setZoom((value) => clampZoom(value - ZOOM_STEP))}
						>
							Zoom out
						</Button>
						<span className="min-w-12 text-center text-xs text-fg-muted">
							{Math.round(zoom * 100)}%
						</span>
						<Button
							variant="outline"
							size="xs"
							onClick={() => setZoom((value) => clampZoom(value + ZOOM_STEP))}
						>
							Zoom in
						</Button>
						<Button variant="secondary" size="xs" onClick={() => setZoom(1)}>
							Reset
						</Button>
					</div>
					<div className="max-h-[70vh] overflow-auto rounded-md border border-border bg-canvas p-3">
						<div
							data-testid="mermaid-expanded"
							data-zoom={zoom}
							className="transition-transform [&_svg]:h-auto [&_svg]:max-w-full"
							style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
						>
							<SanitizedSvg svg={drawn.svg} />
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
