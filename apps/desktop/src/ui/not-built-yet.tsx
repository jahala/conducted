/**
 * @feature APP-04 "Not built yet" boundary
 * Owns: catching the scaffold's NotImplemented errors during render and showing which feature is
 * missing, so the app shell stays usable while parts are unbuilt. Other errors show the generic
 * error card and are logged.
 * Behaviour: ui-map.md 7.4 (Conductor wraps each chat turn and tab in an error boundary).
 * Our design choice: placeholders are visible on screen, named by backlog id.
 * Test first: a child that calls notImplemented("CHAT-06") renders "Not built yet: CHAT-06".
 */
import { NotImplemented } from "@conducted/shared";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	/** Shown above the feature id, e.g. "Chat". */
	area: string;
	children: ReactNode;
}

interface State {
	error: Error | null;
}

export class NotBuiltYet extends Component<Props, State> {
	override state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		if (!(error instanceof NotImplemented)) console.error(error, info.componentStack);
	}

	override render(): ReactNode {
		const { error } = this.state;
		if (error === null) return this.props.children;
		const missing = error instanceof NotImplemented ? error.featureId : null;
		return (
			<div
				role="status"
				className="flex h-full min-h-24 flex-col items-center justify-center gap-1 p-4 text-center"
			>
				<p className="text-sm font-medium">{this.props.area}</p>
				<p className="text-xs opacity-70">
					{missing ? `Not built yet: ${missing}` : "This part failed to load."}
				</p>
			</div>
		);
	}
}
