/**
 * @feature RUN-04 BrowserTab
 * @feature RUN-05 Annotation overlay in the browser tab
 * Owns: a center tab with an in-app browser preview of the workspace's dev server. Entry point
 * embedded by the workspace tab strip. It holds the annotations made on the page and sends them
 * to the workspace's open chat as one message.
 * Behaviour: ui-map.md 3.2, "Tab content: Browser" ("Reload", "Open in browser", "Port and path"
 * picker, "Starting preview..."; setting "In-app browser preview").
 * Children: BrowserToolbar, PreviewFrame, BrowserState, AnnotationOverlay.
 * Data: useRunState (is the dev server running, detected ports), useWorkspace, useSessions,
 * useSetting.
 * Our design choice: the tab draws the page it was opened with. A typed address on another origin
 * opens in the system browser, and a failure to open there shows the "Couldn't open browser tab"
 * toast. The workspace gate hides this tab for an archived workspace.
 * Must handle: the server not running or not yet listening ("Starting preview..." while the frame
 * probes the address, then after the timeout the failed state with a Retry; the frame keeps
 * probing and shows the page without a click once the server answers), the page failing to load,
 * a navigation to another origin opening outside the app, the setting being off (the tab says
 * previews open in the system browser and offers that), a system-browser failure, and sending
 * annotations: they stay in the tab across a page change and go to the workspace's open chat as
 * one message, and a failed send is toasted while the annotations stay.
 * Test first: with the server not listening the tab shows "Starting preview" and, after the
 * timeout, a Retry action.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useEffect, useState } from "react";
import {
	useActions,
	useRunState,
	useSessions,
	useSetting,
	useWorkspace,
} from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import { AnnotationOverlay } from "./AnnotationOverlay.tsx";
import type { PageAnnotation } from "./annotation-format.ts";
import { BrowserState, type BrowserStateKind } from "./BrowserState.tsx";
import { BrowserToolbar, parseBrowserAddress } from "./BrowserToolbar.tsx";
import { PreviewFrame, type PreviewLoadState } from "./PreviewFrame.tsx";

export function BrowserTab({ workspaceId, url }: { workspaceId: WorkspaceId; url: string }) {
	const actions = useActions();
	const workspace = useWorkspace(workspaceId);
	const sessions = useSessions(workspaceId);
	const runState = useRunState(workspaceId);
	const previewEnabled = useSetting<boolean>("experimental_in_app_browser_preview");
	const [history, setHistory] = useState<string[]>([url]);
	const [index, setIndex] = useState(0);
	const [reloadToken, setReloadToken] = useState(0);
	const [loadState, setLoadState] = useState<PreviewLoadState>({ kind: "loading" });
	const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
	const currentUrl = history[index] ?? url;
	const openSessions = sessions.state === "ready" ? sessions.data : [];
	const activeSessionId = workspace.state === "ready" ? workspace.data.activeSessionId : null;
	const archived =
		workspace.state === "ready" &&
		(workspace.data.state === "archived" || workspace.data.state === "archiving");
	const activeSession =
		activeSessionId === null
			? openSessions[0]
			: (openSessions.find((session) => session.id === activeSessionId) ?? openSessions[0]);
	const canSendToChat = !archived && activeSession !== undefined;

	useEffect(() => {
		setHistory([url]);
		setIndex(0);
		setLoadState({ kind: "loading" });
	}, [url]);

	const openExternal = (target: string) => {
		void actions.app.openUrl(target).then((result) => {
			if (!result.ok) toastError("Couldn't open browser tab", result.error);
		});
	};

	const navigate = (raw: string) => {
		const parsed = parseBrowserAddress(raw);
		if (!parsed.ok) {
			toastError("Couldn't open browser tab", parsed.error);
			return;
		}
		if (!parsed.value.localhost) {
			openExternal(parsed.value.url);
			return;
		}
		setHistory((previous) => [...previous.slice(0, index + 1), parsed.value.url]);
		setIndex((previous) => previous + 1);
		setLoadState({ kind: "loading" });
		setReloadToken((token) => token + 1);
	};

	const reload = () => {
		setLoadState({ kind: "loading" });
		setReloadToken((token) => token + 1);
	};

	const back = () => {
		if (index === 0) return;
		setIndex((previous) => previous - 1);
		setLoadState({ kind: "loading" });
	};

	const forward = () => {
		if (index >= history.length - 1) return;
		setIndex((previous) => previous + 1);
		setLoadState({ kind: "loading" });
	};

	const detectedPorts =
		runState.state === "ready" ? runState.data.detectedPorts.map((entry) => entry.port) : [];
	const runPorts =
		runState.state === "ready"
			? runState.data.running.flatMap((entry) => {
					if (entry.url === null) return [];
					const parsed = parseBrowserAddress(entry.url);
					return parsed.ok && parsed.value.port !== null ? [parsed.value.port] : [];
				})
			: [];
	const listening = new Set([...detectedPorts, ...runPorts]);

	const currentAddress = parseBrowserAddress(currentUrl);
	const targetPort = currentAddress.ok ? currentAddress.value.port : null;
	const workspacePort = workspace.state === "ready" ? workspace.data.port : (targetPort ?? 0);

	const serverQuiet =
		loadState.kind === "failed" &&
		(loadState.reason === "timeout" || loadState.reason === "refused");
	const failedKind: BrowserStateKind =
		serverQuiet && runState.state === "ready" && targetPort !== null && !listening.has(targetPort)
			? "server_not_running"
			: "load_failed";
	const failureDetail = loadState.kind === "failed" ? detailFor(loadState, targetPort) : null;

	const sendAnnotations = (message: string): void => {
		if (activeSession === undefined) return;
		void actions.sessions.send(activeSession.id, message, [], "auto").then((result) => {
			if (!result.ok) {
				toastError("Couldn't add the annotations to the chat", result.error);
				return;
			}
			setAnnotations([]);
		});
	};

	return (
		<div className="flex h-full flex-col bg-canvas" data-browser-tab="">
			<BrowserToolbar
				url={currentUrl}
				loading={loadState.kind === "loading"}
				canGoBack={index > 0}
				canGoForward={index < history.length - 1}
				workspacePort={workspacePort}
				detectedPorts={detectedPorts}
				onNavigate={navigate}
				onBack={back}
				onForward={forward}
				onReload={reload}
				onOpenExternally={() => openExternal(currentUrl)}
			/>
			<div className="relative min-h-0 flex-1">
				{previewEnabled ? (
					<>
						<PreviewFrame
							key={`${currentUrl}:${reloadToken}`}
							url={currentUrl}
							onLoadState={setLoadState}
						/>
						{loadState.kind === "loading" ? (
							<div className="absolute inset-0 bg-canvas">
								<BrowserState kind="starting" detail={null} onAction={reload} />
							</div>
						) : null}
						{loadState.kind === "failed" ? (
							<div className="absolute inset-0 bg-canvas">
								<BrowserState kind={failedKind} detail={failureDetail} onAction={reload} />
							</div>
						) : null}
						{loadState.kind === "ready" ? (
							<AnnotationOverlay
								annotations={annotations}
								canSendToChat={canSendToChat}
								onAdd={(annotation) => setAnnotations((current) => [...current, annotation])}
								onRemove={(id) =>
									setAnnotations((current) => current.filter((item) => item.id !== id))
								}
								onSendToChat={sendAnnotations}
								onClear={() => setAnnotations([])}
							/>
						) : null}
					</>
				) : (
					<BrowserState
						kind="preview_off"
						detail={null}
						onAction={() => openExternal(currentUrl)}
					/>
				)}
			</div>
		</div>
	);
}

function detailFor(
	state: Extract<PreviewLoadState, { kind: "failed" }>,
	port: number | null,
): string {
	const address = port === null ? "the preview" : `localhost:${port}`;
	switch (state.reason) {
		case "refused":
			return `The connection to ${address} was refused.`;
		case "timeout":
			return `The preview at ${address} did not answer in time.`;
	}
}
