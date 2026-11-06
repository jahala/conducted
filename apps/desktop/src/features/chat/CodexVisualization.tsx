/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: the frame that shows an HTML file Codex wrote as a "visualization", with an "Open" button
 * that opens the file in a tab.
 * Behaviour: coverage/inventory-ui-text.md ("Codex inline visualizations": a sandboxed frame with
 * "Open"; a path outside the workspace shows "Visualization is outside the workspace:"; a file that
 * cannot be read shows "Couldn’t load visualization"); ui-map.md 3.3 (chat items).
 * Data: the file text comes from useFileContent; the workspace root from useWorkspace; the home
 * folder from the Platform for a path that starts with "~".
 * Must handle: a path outside the workspace root (absolute, climbing with "..", or "~") shows the
 * notice and loads nothing; a missing file shows the load failure and loads when the file appears;
 * a page that runs scripts is sandboxed without same-origin access and cannot reach the network;
 * the frame follows its content up to a maximum height, then scrolls; the file changing on disk
 * reloads the frame.
 * Our design choice: the frame is isolated from the app by an opaque origin, so a visualization can
 * never read the app's storage or call Tauri commands.
 * Test first: a path outside the workspace root renders "Visualization is outside the workspace:"
 * with the path and loads no frame.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useFileContent, useWorkspace } from "../../core/hooks.ts";
import { workspaceRelativePath } from "../../core/services/git.ts";
import { Button } from "../../ui/Button.tsx";

export interface CodexVisualizationProps {
	workspaceId: WorkspaceId;
	/** The file path Codex reported. Absolute, or relative to the workspace root. */
	path: string;
	/** Opens the file in a tab of the workspace, by its path relative to the workspace root. */
	onOpen: (path: string) => void;
}

const OUTSIDE_NOTICE = "Visualization is outside the workspace:";
const LOAD_FAILED = "Couldn’t load visualization";
const LOADING = "Loading visualization...";

/** The frame starts this tall, follows its content, and scrolls once it reaches the maximum. */
const MIN_FRAME_HEIGHT = 96;
const MAX_FRAME_HEIGHT = 480;
const HEIGHT_MESSAGE = "conducted-visualization";

const FRAME_POLICY =
	"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

/**
 * The document the frame loads. It blocks network access, then reports its height as the content
 * changes so the frame can follow it. The page keeps its own markup and scripts.
 */
const HEIGHT_SCRIPT = `<script>(function(){function report(){parent.postMessage({type:"${HEIGHT_MESSAGE}",height:Math.ceil(document.documentElement.scrollHeight)},"*")}addEventListener("load",report);if(typeof ResizeObserver==="function"){new ResizeObserver(report).observe(document.documentElement)}report()})();</script>`;

function frameDocument(html: string): string {
	const policy = `<meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`;
	const withPolicy = /<head[\s>]/i.test(html)
		? html.replace(/<head([^>]*)>/i, (head) => `${head}${policy}`)
		: `${policy}${html}`;
	return /<\/body>/i.test(withPolicy)
		? withPolicy.replace(/<\/body>/i, (body) => `${HEIGHT_SCRIPT}${body}`)
		: `${withPolicy}${HEIGHT_SCRIPT}`;
}

type ResolvedPath = { ok: true; relative: string } | { ok: false };

/** A file path inside the workspace root, as the file hooks want it. */
function relativeInsideWorkspace(root: string, path: string, home: string): ResolvedPath {
	const expanded = path === "~" || path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
	if (!expanded.startsWith("/")) {
		const checked = workspaceRelativePath(expanded);
		return checked.ok ? { ok: true, relative: checked.value } : { ok: false };
	}
	const base = root === "/" ? "" : root.replace(/\/+$/, "");
	const prefix = base === "" ? "/" : `${base}/`;
	if (!expanded.startsWith(prefix)) return { ok: false };
	const checked = workspaceRelativePath(expanded.slice(prefix.length));
	return checked.ok ? { ok: true, relative: checked.value } : { ok: false };
}

function FrameChrome({ children }: { children: ReactNode }) {
	return (
		<div
			data-region="codex-visualization"
			className="flex flex-col gap-2 overflow-hidden rounded-md border border-border bg-surface"
		>
			{children}
		</div>
	);
}

function FrameHeader({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return (
		<div className="flex items-center justify-between gap-2 px-2 py-1">
			<span className="truncate text-xs font-medium text-fg">Visualization</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted" title={path}>
				{name}
			</span>
			{onOpen === undefined ? null : (
				<Button variant="secondary" size="xs" onClick={() => onOpen(path)}>
					Open
				</Button>
			)}
		</div>
	);
}

function LoadingFrame() {
	return (
		<FrameChrome>
			<div role="status" aria-label="Loading visualization" className="px-2 py-1">
				<p className="text-xs text-fg-subtle">{LOADING}</p>
			</div>
		</FrameChrome>
	);
}

function FailedFrame({ path, onOpen }: { path: string; onOpen?: (path: string) => void }) {
	return (
		<FrameChrome>
			<FrameHeader path={path} onOpen={onOpen} />
			<p className="px-2 pb-2 text-xs text-fg-muted">{LOAD_FAILED}</p>
		</FrameChrome>
	);
}

function OutsideFrame({ path }: { path: string }) {
	return (
		<FrameChrome>
			<div className="px-3 py-2">
				<p className="text-xs font-medium text-danger">{OUTSIDE_NOTICE}</p>
				<p className="break-all font-mono text-xs text-fg-muted">{path}</p>
			</div>
		</FrameChrome>
	);
}

function FramedHtml({
	html,
	path,
	onOpen,
}: {
	html: string;
	path: string;
	onOpen: (path: string) => void;
}) {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(MIN_FRAME_HEIGHT);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== frameRef.current?.contentWindow) return;
			const data = event.data as { type?: unknown; height?: unknown } | null;
			if (data === null || typeof data !== "object") return;
			if (data.type !== HEIGHT_MESSAGE || typeof data.height !== "number") return;
			if (!Number.isFinite(data.height)) return;
			setHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, Math.ceil(data.height))));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	return (
		<FrameChrome>
			<FrameHeader path={path} onOpen={onOpen} />
			<iframe
				ref={frameRef}
				title="Visualization"
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				srcDoc={frameDocument(html)}
				style={{ height }}
				className="w-full border-0"
			/>
		</FrameChrome>
	);
}

function LoadedVisualization({
	workspaceId,
	relative,
	onOpen,
}: {
	workspaceId: WorkspaceId;
	relative: string;
	onOpen: (path: string) => void;
}) {
	const content = useFileContent(workspaceId, relative);
	if (content.state === "loading") return <LoadingFrame />;
	if (content.state === "error" || content.data.kind !== "text") {
		return <FailedFrame path={relative} onOpen={onOpen} />;
	}
	return (
		<FramedHtml
			key={`${relative}:${content.data.modifiedAt}`}
			html={content.data.text}
			path={relative}
			onOpen={onOpen}
		/>
	);
}

export function CodexVisualization({ workspaceId, path, onOpen }: CodexVisualizationProps) {
	const workspace = useWorkspace(workspaceId);
	const { platform } = useServices();
	if (workspace.state === "loading") return <LoadingFrame />;
	if (workspace.state === "error") return <FailedFrame path={path} />;
	const resolved = relativeInsideWorkspace(workspace.data.path, path, platform.fs.paths.home);
	if (!resolved.ok) return <OutsideFrame path={path} />;
	return (
		<LoadedVisualization workspaceId={workspaceId} relative={resolved.relative} onOpen={onOpen} />
	);
}
