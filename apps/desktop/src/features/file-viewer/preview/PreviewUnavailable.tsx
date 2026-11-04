/**
 * @feature REV-08 Preview unavailable
 * Owns: the notice for a file that has no preview, or whose preview failed.
 * Behaviour: ui-map.md 7.4 ("Preview unavailable", per-type failure texts).
 * Must handle: showing the file size and type, offering "Open in another app" and "Reveal in
 * Finder", and an optional retry when the cause was a failed load.
 * Test first: with a retry handler the Retry button shows, without one it does not.
 */
import { notImplemented } from "@conducted/shared";

export interface PreviewUnavailableProps {
	fileName: string;
	sizeBytes: number | null;
	reason: string;
	onRetry?: () => void;
	onOpenExternally: () => void;
	onReveal: () => void;
}

export function PreviewUnavailable(_props: PreviewUnavailableProps): never {
	return notImplemented("REV-08");
}
