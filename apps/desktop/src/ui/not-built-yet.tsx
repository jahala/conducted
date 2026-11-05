/**
 * @feature APP-04 "Not built yet" boundary
 * Owns: catching the scaffold's NotImplemented errors during render and showing which feature is
 * missing, so the app shell stays usable while parts are unbuilt. Other errors show the generic
 * error card and are logged.
 * Behaviour: ui-map.md 7.4 (Conductor wraps each chat turn and tab in an error boundary).
 * Our design choice: placeholders are visible on screen, named by backlog id. A boundary clears itself when
 * `resetKey` changes, so moving to another workspace or tab gets a fresh try. The `overlay` variant is for
 * dialogs and palettes, which have no region of their own: it shows a small card over the window with a
 * close button. The `inline` variant is one line of small text, for footers and toolbars.
 * Must handle: a NotImplemented error shows its feature id; any other error shows a generic card with the
 * error's message and, in the region variant, "Try again", and is logged; a new `resetKey` clears the error; `overlay` without `onDismiss` still renders (no close button).
 * Test first: a child that calls notImplemented for a feature renders "Not built yet: <id>".
 */
import { NotImplemented } from "@conducted/shared";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	/** Shown above the feature id, e.g. "Chat". */
	area: string;
	/** When this value changes, a shown error is cleared. */
	resetKey?: string | number;
	variant?: "region" | "overlay" | "inline";
	/** Closes an overlay that failed to build. */
	onDismiss?: () => void;
	children: ReactNode;
}

interface State {
	error: Error | null;
	resetKey: string | number | undefined;
}

export class NotBuiltYet extends Component<Props, State> {
	override state: State = { error: null, resetKey: this.props.resetKey };

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { error };
	}

	static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
		if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
		return null;
	}

	retry = (): void => {
		this.setState({ error: null });
	};

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		if (!(error instanceof NotImplemented)) console.error(error, info.componentStack);
	}

	override render(): ReactNode {
		const { error } = this.state;
		if (error === null) return this.props.children;
		const missing = error instanceof NotImplemented ? error.featureId : null;
		const { area, variant = "region", onDismiss } = this.props;
		const message = missing ? `Not built yet: ${missing}` : "This part failed to load.";
		if (variant === "inline") {
			return (
				<p role="status" className="px-2 py-1 text-xs text-fg-subtle">
					{area}: {message}
				</p>
			);
		}
		if (variant === "overlay") {
			return (
				<div
					role="status"
					className="fixed left-1/2 top-[20%] z-50 flex w-80 -translate-x-1/2 flex-col items-center gap-1 rounded-lg bg-raised p-5 text-center shadow-popover"
				>
					<p className="text-sm font-semibold text-fg">{area}</p>
					<p className="text-xs text-fg-muted">{message}</p>
					{onDismiss ? (
						<button
							type="button"
							onClick={onDismiss}
							className="mt-2 h-7 rounded-md border border-border-strong px-3 text-sm font-medium text-fg hover:bg-hover"
						>
							Close
						</button>
					) : null}
				</div>
			);
		}
		return (
			<div
				role="status"
				className="flex h-full min-h-16 w-full flex-col items-center justify-center gap-1 p-4 text-center"
			>
				<p className="text-sm font-medium text-fg">{area}</p>
				<p className="text-xs text-fg-muted">{message}</p>
				{missing === null ? (
					<>
						<p className="max-w-prose text-xs text-fg-subtle">{error.message}</p>
						<button
							type="button"
							onClick={this.retry}
							className="mt-2 h-7 rounded-md border border-border-strong px-3 text-sm font-medium text-fg hover:bg-hover"
						>
							Try again
						</button>
					</>
				) : null}
			</div>
		);
	}
}
