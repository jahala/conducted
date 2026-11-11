/**
 * @feature CHAT-22 Codex visualizations in the chat
 * Owns: the frame that shows an HTML file Codex wrote as a "visualization", with an "Open" button
 * that opens the file in a tab.
 * Behaviour: coverage/inventory-ui-text.md ("Codex inline visualizations": a sandboxed frame with
 * "Open"; a path outside the workspace shows "Visualization is outside the workspace:"; a file that
 * cannot be read shows "Couldn’t load visualization"); ui-map.md 3.3 (chat items).
 * Data: the file text comes from useFileContent; the workspace root from useWorkspace; the home
 * folder from the Platform for a path that starts with "~"; the frame's address from
 * `platform.visualizations`, which serves the document from the Rust shell (visualization.rs).
 * Must handle: a path outside the workspace root (absolute, climbing with "..", or "~") shows the
 * notice and loads nothing; a missing file shows the load failure and loads when the file appears;
 * a page that runs scripts is sandboxed without same-origin access; its scripts run although the
 * app's own policy allows no inline script, because the page is served from its own origin with
 * its own policy, which blocks loads, fetches and form posts for every script (a script that
 * points the frame itself at a web address is outside the frame's policy; only the app's own
 * policy and navigation guard cover that); a page the shell cannot serve shows the load failure;
 * the page is dropped from the shell when its frame goes, also when the shell answers after that;
 * the frame follows its content up to a maximum height, then scrolls; the file changing on disk
 * reloads the frame.
 * Our design choice: the frame is isolated from the app by an opaque origin, so a visualization can
 * never read the app's storage or the key Tauri commands need. `CodexVisualizationForWrite` mounts
 * it under a Codex chat's write card when the written path is an HTML file.
 * Test first: a path outside the workspace root renders "Visualization is outside the workspace:"
 * with the path and loads no frame.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { workspaceRelativePath } from "../../core/git-text.ts";
import { useChat, useFileContent, useWorkspace } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { FRAME_SANDBOX, frameDocument, HEIGHT_MESSAGE } from "./visualization-frame.ts";
import { useWorkspaceLinks } from "./workspace-links.ts";

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

type ServedPage = { state: "serving" } | { state: "ready"; url: string } | { state: "failed" };

/**
 * Hands the frame's document to the Rust shell, which serves it from the visualization scheme
 * with the frame's own policy, and drops it again when the frame goes. An answer that arrives
 * after the frame is gone is released at once.
 */
function useServedPage(html: string): ServedPage {
	const { platform } = useServices();
	const [page, setPage] = useState<ServedPage>({ state: "serving" });

	useEffect(() => {
		const { visualizations, app } = platform;
		let live = true;
		let servedId: string | null = null;
		const release = (id: string) => {
			void visualizations.release(id).then((released) => {
				if (!released.ok) {
					app.writeLog("warn", `Could not drop a visualization page: ${released.error.message}`);
				}
			});
		};
		setPage({ state: "serving" });
		void visualizations.serve(frameDocument(html)).then((served) => {
			if (!served.ok) {
				if (live) setPage({ state: "failed" });
				return;
			}
			if (!live) {
				release(served.value.id);
				return;
			}
			servedId = served.value.id;
			setPage({ state: "ready", url: served.value.url });
		});
		return () => {
			live = false;
			if (servedId !== null) release(servedId);
		};
	}, [html, platform]);

	return page;
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
	const page = useServedPage(html);

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

	if (page.state === "failed") return <FailedFrame path={path} onOpen={onOpen} />;
	return (
		<FrameChrome>
			<FrameHeader path={path} onOpen={onOpen} />
			<iframe
				ref={frameRef}
				title="Visualization"
				sandbox={FRAME_SANDBOX}
				referrerPolicy="no-referrer"
				src={page.state === "ready" ? page.url : undefined}
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

/** True when a written path names an HTML file, which is what Codex writes as a visualization. */
export function isVisualizationPath(path: string): boolean {
	return /\.(?:html?|xhtml)$/i.test(path);
}

export interface CodexVisualizationForWriteProps {
	sessionId: SessionId;
	/** The path from the write call, absolute or relative to the workspace root. */
	path: string;
}

/**
 * The frame under a Codex chat's write of an HTML file. It finds the workspace through the
 * session, so the write card can show the file without taking a workspace prop it does not get.
 */
export function CodexVisualizationForWrite({ sessionId, path }: CodexVisualizationForWriteProps) {
	const chat = useChat(sessionId);
	const links = useWorkspaceLinks();
	if (chat.state !== "ready" || chat.data.session.config.agent !== "codex") return null;
	return (
		<CodexVisualization
			workspaceId={chat.data.session.workspaceId}
			path={path}
			onOpen={(relative) => links.openFile(relative, "edit")}
		/>
	);
}
