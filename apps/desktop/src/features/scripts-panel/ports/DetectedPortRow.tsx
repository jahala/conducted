/**
 * @feature RUN-03 Detected port row
 * Owns: one listening port with its Open in browser and Open in preview actions.
 * Behaviour: ui-map.md 3.7 (Ports tab; the in-app browser setting decides where Open goes).
 * Must handle: the workspace's own port marked, the in-app preview unavailable when the setting is
 * off, and copy of the URL.
 * Test first: with the in-app browser setting off, only the system browser action shows.
 */
import { notImplemented } from "@conducted/shared";

export interface DetectedPortRowProps {
	port: number;
	isWorkspacePort: boolean;
	inAppPreviewEnabled: boolean;
	onOpenInBrowser: () => void;
	onOpenInPreview: () => void;
	onCopyUrl: () => void;
}

export function DetectedPortRow(_props: DetectedPortRowProps): never {
	return notImplemented("RUN-03");
}
