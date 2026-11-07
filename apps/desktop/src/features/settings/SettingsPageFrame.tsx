/**
 * @feature SET-02 Settings page frame
 * Owns: the common frame of every settings page: title, description, sections, the designed
 * loading and error states of the settings store, and the notice that lists settings-file entries
 * the store dropped. `useSettingsLoad` reads that state from the settings store for a page.
 * Behaviour: ui-map.md 6 and 7.3 to 7.4 (loading skeletons with role status, error cards);
 * services-map.md 4.2.1 (a notice lists the dropped entries: bad TOML, unknown key, wrong type).
 * Must handle: loading (skeleton rows until the store has loaded), a failed load (error card whose
 * Retry reads the settings again), dropped entries (listed above the page), and a setting being
 * scrolled into view when the page opens from search.
 * Test first: with state "error" the frame shows the message and a Retry button that calls onRetry.
 */
import { type ReactNode, useEffect } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import type { DroppedReason, DroppedSetting } from "../../core/services/settings.ts";
import { Alert, AlertDescription, AlertTitle } from "../../ui/Alert.tsx";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";

/** What the settings store says about its last read, in the shape the frame takes. */
export interface SettingsLoad {
	state: "loading" | "error" | "ready";
	errorMessage: string | null;
	onRetry: () => void;
	dropped: readonly DroppedSetting[];
}

const NO_DROPPED: readonly DroppedSetting[] = [];

/** The settings store's load state: loading until the first read, error when a read failed. */
export function useSettingsLoad(): SettingsLoad {
	const { services } = useServices();
	const loaded = useStore(services.settings.store, (state) => state.loaded);
	const warnings = useStore(services.settings.store, (state) => state.warnings);
	const dropped = useStore(services.settings.store, (state) => state.dropped);
	const failure = warnings.find((warning) => warning.code === "settings_load_failed") ?? null;
	return {
		state: !loaded ? "loading" : failure !== null ? "error" : "ready",
		errorMessage: failure?.message ?? null,
		onRetry: () => void services.settings.reloadFromDisk(),
		dropped: loaded ? dropped : NO_DROPPED,
	};
}

const DROPPED_REASON: Readonly<Record<DroppedReason, string>> = {
	"unreadable-file": "the file could not be read",
	"invalid-file": "the file is not valid TOML",
	"unknown-key": "unknown setting",
	"wrong-type": "wrong type of value",
	"unsupported-value": "value not supported",
};

export interface SettingsPageFrameProps extends SettingsLoad {
	title: string;
	/** The page's subtitle under the title; most pages have none, as in Conductor. */
	description: ReactNode | null;
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
	dropped,
	focusSettingKey,
	children,
}: SettingsPageFrameProps) {
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
		<div className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">{title}</h1>
				{description ? <p className="text-sm text-fg-muted">{description}</p> : null}
			</header>
			{dropped.length === 0 ? null : (
				<Alert>
					<AlertTitle>Some saved settings were ignored</AlertTitle>
					<AlertDescription>
						<ul className="flex flex-col gap-0.5">
							{dropped.map((entry) => (
								<li key={`${entry.file}:${entry.key}:${entry.reason}`}>
									<span className="font-mono">{entry.key}</span> in {entry.file}:{" "}
									{DROPPED_REASON[entry.reason]}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			)}
			<div className="flex flex-col">{children}</div>
		</div>
	);
}
