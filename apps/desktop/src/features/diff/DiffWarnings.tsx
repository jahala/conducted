/**
 * @feature REV-02 Diff warnings
 * Owns: the notice shown above or instead of a diff when it cannot be drawn normally.
 * Behaviour: ui-map.md 3.6 ("Only whitespace changes found" with "Show whitespace changes",
 * "Binary file changed", "Updating diff", "Dismiss diff rendering warning").
 * Kinds: "binary" (no render), "too_large" (button to render anyway), "whitespace_only" (button to
 * show whitespace changes), "updating" (the files changed on disk, a new diff is on the way),
 * "render_failed" (the renderer threw, with Retry).
 * Must handle: a dismissible warning staying dismissed for that file until it changes, and two
 * warnings at once (updating plus too_large shows the first only).
 * Test first: kind "whitespace_only" shows an action that calls onAction.
 */
import { Alert, AlertDescription, AlertTitle } from "../../ui/Alert.tsx";
import { Button } from "../../ui/Button.tsx";
import { CloseIcon } from "../../ui/icons.tsx";
import { Spinner } from "../../ui/Spinner.tsx";

export type DiffWarningKind =
	| "binary"
	| "too_large"
	| "whitespace_only"
	| "updating"
	| "render_failed";

export interface DiffWarningProps {
	kind: DiffWarningKind;
	onAction: () => void;
	onDismiss: () => void;
}

interface WarningCopy {
	title: string;
	action: string | null;
	dismissible: boolean;
}

const COPY: Record<DiffWarningKind, WarningCopy> = {
	binary: { title: "Binary file changed", action: null, dismissible: true },
	too_large: {
		title: "This file is too large to show",
		action: "Render anyway",
		dismissible: true,
	},
	whitespace_only: {
		title: "Only whitespace changes found",
		action: "Show whitespace changes",
		dismissible: true,
	},
	updating: { title: "Updating diff", action: null, dismissible: false },
	render_failed: { title: "Failed to open editor", action: "Retry", dismissible: true },
};

export function DiffWarning({ kind, onAction, onDismiss }: DiffWarningProps) {
	const copy = COPY[kind];
	return (
		<Alert
			tone={kind === "render_failed" ? "destructive" : "default"}
			icon={kind === "updating" ? <Spinner size="sm" label="Updating diff" /> : undefined}
			className="m-3"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<AlertTitle>{copy.title}</AlertTitle>
					{kind === "binary" ? (
						<AlertDescription>The file's contents are not shown.</AlertDescription>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{copy.action !== null ? (
						<Button variant="outline" size="xs" onClick={onAction}>
							{copy.action}
						</Button>
					) : null}
					{copy.dismissible ? (
						<Button
							variant="ghost"
							size="xs"
							aria-label="Dismiss diff rendering warning"
							onClick={onDismiss}
						>
							<CloseIcon className="size-3.5" />
						</Button>
					) : null}
				</div>
			</div>
		</Alert>
	);
}
