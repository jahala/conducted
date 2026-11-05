/**
 * @feature SET-02 Settings page frame
 * Owns: the common frame of every settings page: title, description, sections, and the designed
 * loading and error states for the page's data.
 * Behaviour: ui-map.md 6 and 7.3 to 7.4 (loading skeletons with role status, error cards).
 * Must handle: loading (skeleton rows), error with Retry, a long page scrolling under a fixed
 * title, and a section anchor being scrolled into view when the page opens from search.
 * Test first: with state "error" the frame shows the message and a Retry button that calls onRetry.
 */
import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";

export interface SettingsPageFrameProps {
	title: string;
	description: string | null;
	state: "loading" | "error" | "ready";
	errorMessage: string | null;
	onRetry: () => void;
	/** The setting to scroll to and highlight, when the page opened from search. */
	focusSettingKey: string | null;
	children: ReactNode;
}

export function SettingsPageFrame({
	title,
	description,
	state,
	errorMessage,
	onRetry,
	focusSettingKey,
	children,
}: SettingsPageFrameProps) {
	const container = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (state !== "ready" || focusSettingKey === null) return;
		const target = document.getElementById(`setting-${focusSettingKey}`);
		target?.scrollIntoView?.({ block: "center" });
	}, [state, focusSettingKey]);

	if (state === "loading") {
		return (
			<div role="status" aria-label={`Loading ${title}`} className="flex flex-col gap-4">
				<Skeleton className="h-8 w-48" />
				{[0, 1, 2].map((index) => (
					<Skeleton key={index} className="h-20 w-full" />
				))}
			</div>
		);
	}

	if (state === "error") {
		return (
			<EmptyState
				title="Couldn't load this settings page"
				body={errorMessage ?? "The settings could not be read."}
				action={
					<Button variant="secondary" onClick={onRetry}>
						Retry
					</Button>
				}
			/>
		);
	}

	return (
		<div ref={container} className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">{title}</h1>
				{description ? <p className="text-sm text-fg-muted">{description}</p> : null}
			</header>
			<div className="flex flex-col">{children}</div>
		</div>
	);
}
