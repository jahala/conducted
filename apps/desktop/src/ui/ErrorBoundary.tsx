/**
 * @feature APP-04 ErrorBoundary
 * Owns: catching render errors in one part of the screen, so the rest stays usable.
 * Behaviour: ui-map.md 7.4 (boundaries per chat turn, per chat tab, tab strip, diff renderer).
 * Must handle: the fallback gets the error and a reset function; a new `resetKey` clears the error
 * (for example when the user switches tabs); NotImplemented errors are left to NotBuiltYet and are re-thrown.
 * Test first: a child that throws shows the fallback; changing resetKey renders the child again.
 */
import { NotImplemented } from "@conducted/shared";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	fallback: (error: Error, reset: () => void) => ReactNode;
	/** When this value changes, a shown error is cleared. */
	resetKey?: string | number;
	children: ReactNode;
}

interface State {
	error: Error | null;
	resetKey: string | number | undefined;
}

export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null, resetKey: this.props.resetKey };

	static getDerivedStateFromError(error: Error): Partial<State> {
		if (error instanceof NotImplemented) throw error;
		return { error };
	}

	static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
		if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
		return null;
	}

	override componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error(error, info.componentStack);
	}

	reset = (): void => {
		this.setState({ error: null });
	};

	override render(): ReactNode {
		const { error } = this.state;
		return error === null ? this.props.children : this.props.fallback(error, this.reset);
	}
}
