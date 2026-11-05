/**
 * @feature APP-04 LoadableView
 * Owns: showing the three states of a Loadable the same way everywhere: loading, error with a retry, ready.
 * Behaviour: ui-map.md 7.3 and 7.4 (loading regions with role="status"; error cards with "Try again").
 * Our design choice: screens give a `loading` element that matches their layout (skeletons), and the error card
 * is shared. An empty list is the caller's business: `children` receives the data and shows its own empty state.
 * Must handle: loading with no skeleton given (a spinner), an error without a retry, switching from ready back
 * to loading shows the skeleton again.
 * Test first: loading shows the label, error shows the message and Retry, ready renders children with the data.
 */
import type { ReactNode } from "react";
import type { Loadable } from "../core/api.ts";
import { Button } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { Spinner } from "./Spinner.tsx";

export interface LoadableViewProps<T> {
	value: Loadable<T>;
	/** What is loading, for screen readers: "Loading workspaces". */
	loadingLabel: string;
	/** A layout-shaped placeholder. Defaults to a centred spinner. */
	loading?: ReactNode;
	/** What failed, as a title: "Couldn't load workspaces". */
	errorTitle: string;
	onRetry?: () => void;
	compact?: boolean;
	children: (data: T) => ReactNode;
}

export function LoadableView<T>({
	value,
	loadingLabel,
	loading,
	errorTitle,
	onRetry,
	compact = false,
	children,
}: LoadableViewProps<T>) {
	if (value.state === "loading") {
		if (loading === undefined) {
			return (
				<div className="flex h-full w-full items-center justify-center p-6 text-fg-subtle">
					<Spinner label={loadingLabel} size="lg" />
				</div>
			);
		}
		return (
			<div role="status" aria-label={loadingLabel} className="h-full w-full">
				{loading}
			</div>
		);
	}
	if (value.state === "error") {
		return (
			<EmptyState
				compact={compact}
				tone="failed"
				title={errorTitle}
				body={value.error.message}
				action={
					onRetry ? (
						<Button variant="secondary" onClick={onRetry}>
							Try again
						</Button>
					) : undefined
				}
			/>
		);
	}
	return <>{children(value.data)}</>;
}
