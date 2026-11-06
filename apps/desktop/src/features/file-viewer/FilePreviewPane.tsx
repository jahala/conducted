/**
 * @feature REV-08 File preview pane
 * Owns: choosing the preview for a file and showing it. It uses classifyPreview and renders one of
 * the preview components.
 * Behaviour: ui-map.md 3.2 (previews for Markdown, SVG with "View raw SVG code" and "View rendered
 * SVG", images, PDF, CSV, video; "Preview unavailable").
 * Children: preview/MarkdownPreview, ImagePreview, SvgPreview, PdfPreview, CsvPreview,
 * VideoPreview, PreviewUnavailable.
 * Must handle: a preview that fails to load (the preview's own error card, with Retry), a file
 * with no preview (the unavailable notice), a binary file with no URL the webview can load, and a
 * Markdown file's links: a web link opens in the browser, a relative link opens that workspace
 * file in the tab, and a relative image loads from the workspace folder.
 * "Open in another app" and "Reveal in Finder" are not offered: the Actions table has no call that
 * opens or reveals a file (CHAT-29 owns `attachments.openExternally`).
 * Test first: a path ending in ".md" renders the Markdown preview, and ".bin" renders the
 * unavailable notice.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import {
	fileQueryKey,
	useActions,
	useFileContent,
	useSetting,
	useWorkspace,
} from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import { FileTabState } from "./FileTabState.tsx";
import { CsvPreview } from "./preview/CsvPreview.tsx";
import { ImagePreview } from "./preview/ImagePreview.tsx";
import { MarkdownPreview } from "./preview/MarkdownPreview.tsx";
import { PdfPreview } from "./preview/PdfPreview.tsx";
import { PreviewUnavailable } from "./preview/PreviewUnavailable.tsx";
import { classifyPreview } from "./preview/preview-kind.ts";
import { SvgPreview } from "./preview/SvgPreview.tsx";
import { VideoPreview } from "./preview/VideoPreview.tsx";

export interface FilePreviewPaneProps {
	workspaceId: WorkspaceId;
	path: string;
	/** Opens another workspace file, by its path relative to the workspace. */
	onOpenFile: (path: string) => void;
}

const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

export function FilePreviewPane({ workspaceId, path, onOpenFile }: FilePreviewPaneProps) {
	const content = useFileContent(workspaceId, path);
	const workspace = useWorkspace(workspaceId);
	const queryClient = useQueryClient();
	const markdownStyle = useSetting<"default" | "tufte">("markdown_style");
	const actions = useActions();
	const { platform } = useServices();
	const [svgView, setSvgView] = useState<"rendered" | "source">("rendered");

	const retry = (): void => {
		void queryClient.invalidateQueries({ queryKey: fileQueryKey(workspaceId, path) });
	};

	const openUrl = (url: string): void => {
		void actions.app.openUrl(url).then((result) => {
			if (!result.ok) toastError("Couldn't open the link", result.error);
		});
	};

	const workspaceRoot =
		workspace.state === "ready" ? workspace.data.path.replace(/\/+$/, "") : null;
	const imageUrlFor = (relativePath: string): string | null =>
		workspaceRoot === null ? null : platform.fs.assetUrl(`${workspaceRoot}/${relativePath}`);

	if (content.state === "loading") {
		return <FileTabState kind="loading" detail={null} onAction={retry} />;
	}
	if (content.state === "error") {
		return <FileTabState kind="error" detail={content.error.message} onAction={retry} />;
	}

	const data = content.data;
	if (data.kind === "missing") {
		return <FileTabState kind="missing" detail={null} onAction={retry} />;
	}
	if (data.kind === "too_large") {
		return <FileTabState kind="too_large" detail={null} />;
	}

	const isBinary = data.kind === "binary";
	const kind = classifyPreview(path, isBinary);
	const fileName = fileNameOf(path);

	if (kind === "binary") {
		return (
			<PreviewUnavailable
				fileName={fileName}
				sizeBytes={isBinary ? data.sizeBytes : null}
				reason="This file can't be shown here."
			/>
		);
	}

	if (isBinary) {
		const previewUrl = data.previewUrl;
		if (kind === "image" && previewUrl !== null) {
			return <ImagePreview url={previewUrl} fileName={fileName} />;
		}
		if (kind === "pdf" && previewUrl !== null) {
			return <PdfPreview url={previewUrl} fileName={fileName} />;
		}
		if (kind === "video" && previewUrl !== null) {
			return <VideoPreview url={previewUrl} fileName={fileName} />;
		}
		return (
			<PreviewUnavailable
				fileName={fileName}
				sizeBytes={data.sizeBytes}
				reason="This file can't be shown here."
			/>
		);
	}

	if (kind === "markdown") {
		return (
			<MarkdownPreview
				text={data.text}
				baseDir={folderOf(path)}
				style={markdownStyle}
				onOpenLink={openUrl}
				onOpenFile={onOpenFile}
				imageUrlFor={imageUrlFor}
			/>
		);
	}
	if (kind === "svg") {
		return <SvgPreview source={data.text} view={svgView} onViewChange={setSvgView} />;
	}
	if (kind === "csv") {
		return (
			<CsvPreview text={data.text} delimiter={path.toLowerCase().endsWith(".tsv") ? "\t" : ","} />
		);
	}
	return (
		<pre className="h-full overflow-auto p-4 font-mono text-code text-fg">
			<code>{data.text}</code>
		</pre>
	);
}
