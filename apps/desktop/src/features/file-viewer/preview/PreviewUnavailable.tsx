/**
 * @feature REV-08 Preview unavailable
 * Owns: the notice for a file that has no preview, or whose preview failed.
 * Behaviour: ui-map.md 7.4 ("Preview unavailable", per-type failure texts).
 * Must handle: showing the file size and type, and each action only when the caller passes its
 * handler: Retry (the image, PDF and video previews pass it after a failed load), "Open in another
 * app" and "Reveal in Finder" (the file viewer passes both for a file with no preview, and the
 * video preview passes "Open in another app").
 * Test first: with a retry handler the Retry button shows, without one it does not.
 */
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";

export interface PreviewUnavailableProps {
	fileName: string;
	sizeBytes: number | null;
	reason: string;
	onRetry?: () => void;
	onOpenExternally?: () => void;
	onReveal?: () => void;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A short, human file size. The number is rounded to one decimal above kilobytes. */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	let value = bytes / 1024;
	let unit = 1;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(1)} ${UNITS[unit]}`;
}

const extensionOf = (name: string): string => {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(dot + 1).toUpperCase();
};

export function PreviewUnavailable({
	fileName,
	sizeBytes,
	reason,
	onRetry,
	onOpenExternally,
	onReveal,
}: PreviewUnavailableProps) {
	const extension = extensionOf(fileName);
	const detail = [
		reason,
		[
			fileName,
			extension.length > 0 ? extension : null,
			sizeBytes === null ? null : formatFileSize(sizeBytes),
		]
			.filter((part): part is string => part !== null)
			.join(" · "),
	]
		.filter((part) => part.length > 0)
		.join(" ");
	const secondary =
		onOpenExternally === undefined && onReveal === undefined ? undefined : (
			<div className="flex items-center gap-2">
				{onOpenExternally === undefined ? null : (
					<Button variant="secondary" onClick={onOpenExternally}>
						Open in another app
					</Button>
				)}
				{onReveal === undefined ? null : (
					<Button variant="outline" onClick={onReveal}>
						Reveal in Finder
					</Button>
				)}
			</div>
		);

	return (
		<EmptyState
			title="Preview unavailable. Open the file to try again."
			body={detail}
			action={
				<div className="flex flex-col items-center gap-2">
					{onRetry === undefined ? null : (
						<Button variant="secondary" onClick={onRetry}>
							Retry
						</Button>
					)}
					{secondary}
				</div>
			}
		/>
	);
}
