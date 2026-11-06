/**
 * @feature REV-10 Artifacts tab
 * Owns: the Artifacts tab body. A list of the files the agent left in the workspace's `.context`
 * folder (files only, no folders), in pages, with an "Upload files" button and an "Attach to chat"
 * action on each file. The file's absolute path comes from the workspace files service.
 * Cards for a running preview URL and for each detected port sit in the same list.
 * Behaviour: services-map.md 5A.5.1 and 5A.6.2 (the artifacts command, the exclusions), ui-map.md
 * 3.6 ("Artifacts"). The setting "Show Artifacts tab" decides whether the tab is offered (REV-10).
 * Data: useArtifacts, useWorkspace, useActions, the workspace files service (an artifact's absolute
 * path), the run store's URLs and ports.
 * Must handle: the first page loading ("Loading artifacts..."), a failed first page with Try
 * again, an empty `.context` folder, an omitted-file notice, a next page on demand, an upload the
 * user cancels, an upload that fails (a name already in `.context` included), a file picker that
 * fails to open (its error is shown), an attach with no workspace folder, an archived workspace
 * (the notice instead of a read), and a workspace switch while a read is in flight (the service
 * keeps only the newest answer).
 * Our design choice: the list draws the preview cards before the files, so the two things a user
 * may click first stay at the top. An upload copies the picked files into `.context` itself, as
 * the action contract says.
 * Test first: with `.context/notes.md` the tab lists "notes.md" and its "Attach to chat" button.
 */

import type { WorkspaceId } from "@conducted/shared";
import { messageOf } from "@conducted/shared";
import { useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../../core/context.tsx";
import { useActions, useArtifacts, useWorkspace } from "../../../core/hooks.ts";
import type { ArtifactEntry, ArtifactsView } from "../../../core/model.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { FileIcon, GlobeIcon } from "../../../ui/icons.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { toastError } from "../../../ui/Toast.tsx";

export interface ArtifactsTabProps {
	workspaceId: WorkspaceId;
}

const sizeLabel = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function LoadingArtifacts() {
	return (
		<div className="space-y-2 p-2">
			<p className="px-1 text-sm text-fg-muted">Loading artifacts...</p>
			{["a", "b", "c"].map((key) => (
				<Skeleton key={key} className="h-12 w-full" />
			))}
		</div>
	);
}

interface UrlCardProps {
	label: string;
	url: string;
	onOpen: (url: string) => void;
}

function UrlCard({ label, url, onOpen }: UrlCardProps) {
	return (
		<div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-2">
			<GlobeIcon className="size-4 shrink-0 text-fg-muted" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm text-fg">{label}</p>
				<p className="truncate text-xs text-fg-subtle">{url}</p>
			</div>
			<Button size="xs" variant="outline" onClick={() => onOpen(url)}>
				Open
			</Button>
		</div>
	);
}

interface FileCardProps {
	entry: ArtifactEntry;
	onAttach: (entry: ArtifactEntry) => void;
}

function FileCard({ entry, onAttach }: FileCardProps) {
	return (
		<div className="group flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-2">
			<FileIcon className="size-4 shrink-0 text-fg-muted" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm text-fg" title={entry.path}>
					{entry.path}
				</p>
				<p className="text-xs text-fg-subtle">{sizeLabel(entry.sizeBytes)}</p>
			</div>
			<Button
				size="xs"
				variant="ghost"
				className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
				onClick={() => onAttach(entry)}
			>
				Attach to chat
			</Button>
		</div>
	);
}

function ArtifactsBody({ workspaceId, view }: { workspaceId: WorkspaceId; view: ArtifactsView }) {
	const actions = useActions();
	const services = useServices();
	const run = useStore(
		services.services.runScripts.store,
		(state) => state.byWorkspace[workspaceId],
	);
	const [loadingMore, setLoadingMore] = useState(false);

	const previews = (run?.running ?? []).flatMap((entry) =>
		entry.url === null ? [] : [{ label: "Preview URL", url: entry.url }],
	);
	const ports = (run?.detectedPorts ?? []).map((entry) => ({
		label: `Forwarded port ${entry.port}`,
		url: `http://localhost:${entry.port}`,
	}));

	const openUrl = (url: string) => {
		void actions.app.openUrl(url).then((result) => {
			if (!result.ok) toastError("Couldn't open the URL", result.error);
		});
	};

	const attach = async (entry: ArtifactEntry) => {
		const absolute = await services.services.workspaceFiles.artifactPath(workspaceId, entry.path);
		const result = absolute.ok
			? await actions.files.attachToChat(workspaceId, [absolute.value])
			: absolute;
		if (!result.ok) toastError("Couldn't attach the file to the chat", result.error);
	};

	const loadMore = async () => {
		setLoadingMore(true);
		try {
			const result = await actions.artifacts.loadMore(workspaceId);
			if (!result.ok) toastError("Couldn't load more artifacts", result.error);
		} finally {
			setLoadingMore(false);
		}
	};

	if (view.entries.length === 0 && previews.length === 0 && ports.length === 0) {
		return (
			<EmptyState
				compact
				title="No artifacts yet"
				body="Files the agent saves in the workspace's .context folder appear here."
			/>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			{view.omitted > 0 ? (
				<p
					role="status"
					className="shrink-0 border-b border-separator px-3 py-2 text-xs text-fg-muted"
				>
					{view.omitted === 1
						? "1 file is left out of this list."
						: `${view.omitted} files are left out of this list.`}
				</p>
			) : null}
			<ul aria-label="Artifacts" className="min-h-0 flex-1 list-none space-y-2 overflow-y-auto p-2">
				{previews.map((preview) => (
					<li key={`preview:${preview.url}`}>
						<UrlCard label={preview.label} url={preview.url} onOpen={openUrl} />
					</li>
				))}
				{ports.map((port) => (
					<li key={`port:${port.url}`}>
						<UrlCard label={port.label} url={port.url} onOpen={openUrl} />
					</li>
				))}
				{view.entries.map((entry) => (
					<li key={`file:${entry.path}`}>
						<FileCard entry={entry} onAttach={(picked) => void attach(picked)} />
					</li>
				))}
			</ul>
			{view.hasMore ? (
				<div className="shrink-0 border-t border-separator p-2">
					<Button
						variant="secondary"
						size="sm"
						loading={loadingMore}
						onClick={() => void loadMore()}
					>
						Load more
					</Button>
				</div>
			) : null}
		</div>
	);
}

function LiveArtifactsTab({ workspaceId }: { workspaceId: WorkspaceId }) {
	const artifacts = useArtifacts(workspaceId);
	const services = useServices();
	const actions = useActions();
	const [uploading, setUploading] = useState(false);

	const upload = async () => {
		setUploading(true);
		try {
			let picked: string[];
			try {
				picked = await services.platform.dialogs.pickFiles({
					title: "Upload files",
					multiple: true,
				});
			} catch (error) {
				toastError("Couldn't open the file picker", {
					message: messageOf(error),
				});
				return;
			}
			if (picked.length === 0) return;
			const result = await actions.artifacts.upload(workspaceId, picked);
			if (!result.ok) toastError("Couldn't upload the files", result.error);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-separator px-2 py-2">
				<p className="text-sm font-medium text-fg">Artifacts</p>
				<Button size="sm" variant="outline" loading={uploading} onClick={() => void upload()}>
					Upload files
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden">
				<LoadableView
					value={artifacts}
					loadingLabel="Loading artifacts"
					loading={<LoadingArtifacts />}
					errorTitle="Couldn't load the artifacts"
					onRetry={() => void services.services.workspaceFiles.loadArtifacts(workspaceId)}
					compact
				>
					{(view) => <ArtifactsBody workspaceId={workspaceId} view={view} />}
				</LoadableView>
			</div>
		</div>
	);
}

export function ArtifactsTab({ workspaceId }: ArtifactsTabProps) {
	const workspace = useWorkspace(workspaceId);
	if (workspace.state === "ready" && workspace.data.state === "archived") {
		return (
			<EmptyState
				compact
				title="This workspace is archived"
				body="Restore the workspace to see its artifacts."
			/>
		);
	}
	return <LiveArtifactsTab workspaceId={workspaceId} />;
}
