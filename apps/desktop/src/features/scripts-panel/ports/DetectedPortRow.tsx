/**
 * @feature RUN-03 Detected port row
 * Owns: one listening port with its Open in browser, Open in preview and Activate app actions.
 * Behaviour: ui-map.md 3.7 (Ports tab; the in-app browser setting decides where Open goes; a
 * detected app can be activated instead of opened).
 * Must handle: the workspace's own port marked, the in-app preview unavailable when the setting is
 * off, activating only when an app owns the port, and copy of the URL.
 * Test first: with the in-app browser setting off, only the system browser action shows.
 */
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { EyeIcon, GlobeIcon } from "../../../ui/icons.tsx";

export interface DetectedPortRowProps {
	port: number;
	isWorkspacePort: boolean;
	inAppPreviewEnabled: boolean;
	onOpenInBrowser: () => void;
	onOpenInPreview: () => void;
	onCopyUrl: () => void;
	/** Brings the macOS app that owns the port to the front, when it has one. */
	onActivateApp?: () => void;
	/** The program behind the port, when the process list knows it. */
	processName?: string;
	/** The macOS application that owns the process, when there is one. */
	appName?: string | null;
}

export function DetectedPortRow({
	port,
	isWorkspacePort,
	inAppPreviewEnabled,
	onOpenInBrowser,
	onOpenInPreview,
	onCopyUrl,
	onActivateApp,
	processName,
	appName,
}: DetectedPortRowProps) {
	const url = `http://localhost:${port}`;
	return (
		<div className="flex items-center gap-3 border-b border-separator px-3 py-2 last:border-b-0">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate font-mono text-sm text-fg">localhost:{port}</span>
					{isWorkspacePort ? <Badge>Workspace port</Badge> : null}
				</div>
				{processName === undefined && appName == null ? null : (
					<p className="truncate text-xs text-fg-muted">
						{appName ?? processName}
						{appName != null && processName !== undefined ? ` (${processName})` : ""}
					</p>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<Button variant="ghost" size="xs" title={url} onClick={onCopyUrl}>
					Copy URL
				</Button>
				{appName !== null && appName !== undefined && onActivateApp !== undefined ? (
					<Button variant="outline" size="xs" onClick={onActivateApp} title={appName}>
						<span className="inline-flex items-center gap-1.5">
							<EyeIcon />
							Activate {appName}
						</span>
					</Button>
				) : null}
				<Button variant="outline" size="xs" onClick={onOpenInBrowser} title={url}>
					<span className="inline-flex items-center gap-1.5">
						<GlobeIcon />
						Open in browser
					</span>
				</Button>
				{inAppPreviewEnabled ? (
					<Button variant="outline" size="xs" onClick={onOpenInPreview} title={url}>
						<span className="inline-flex items-center gap-1.5">
							<EyeIcon />
							Open in preview
						</span>
					</Button>
				) : null}
			</div>
		</div>
	);
}
