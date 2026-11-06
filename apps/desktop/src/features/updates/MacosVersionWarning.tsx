/**
 * @feature APP-08 macOS version warning
 * Owns: the dismissible warning in the sidebar footer when the Mac's macOS version is too old for the app.
 * Behaviour: ui-map.md 1.3 (status areas: "macOS version warning with dismiss button"), 4.8 (sidebar
 * footer); coverage/inventory-controls.md (the dismiss button has the aria label "Dismiss macOS version
 * warning").
 * Data: `SystemInfo.osVersion` from the Platform's `system.info()`, the call behind useSystemInfo
 * (PLAT-32). The oldest supported version comes from the build's minimum system version, passed in so the
 * check can be tested.
 * Our design choice: the app supports macOS 14 and newer, the first version whose system `trash` command the
 * app relies on. The dismissal is kept in the web view's storage under one key, holding the app version that
 * was dismissed, so a later update that raises the minimum shows the warning again. The warning uses the
 * warning colour tokens, a function-only state, and sits above the update notice.
 * Must handle: a version string with two or three parts ("15.4", "15.4.1"); a version that cannot be read
 * (no warning); a Mac at exactly the minimum (no warning); dismissal remembered across restarts; the sidebar
 * footer collapsed (nothing is drawn).
 * Test first: osVersion "13.6.1" with minimum "14.0" shows the warning; "14.0" shows nothing; dismissing
 * hides it.
 */
import { useEffect, useState } from "react";
import { useServices } from "../../core/context.tsx";
import type { SystemInfo } from "../../core/model.ts";
import type { Platform } from "../../platform/platform.ts";

export interface MacosVersionWarningProps {
	system: SystemInfo;
	/** The lowest macOS version this build supports, for example "14.0". */
	minimumOsVersion: string;
	dismissed: boolean;
	onDismiss: () => void;
}

/** macOS 14 is the first release whose system `trash` command the app uses. */
export const MINIMUM_MACOS_VERSION = "14.0";

const DISMISSED_KEY = "conducted.macos-version-warning-dismissed";

export interface WarningStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

function browserStorage(): WarningStorage | null {
	try {
		if (typeof window === "undefined") return null;
		return window.localStorage;
	} catch {
		return null;
	}
}

/** The stored app version whose warning was dismissed, or null. */
export function readMacosWarningDismissed(
	storage: WarningStorage | null = browserStorage(),
): string | null {
	return storage?.getItem(DISMISSED_KEY) ?? null;
}

/** Remembers the app version the user dismissed, so the warning returns after an update. */
export function dismissMacosVersionWarning(
	appVersion: string,
	storage: WarningStorage | null = browserStorage(),
): void {
	storage?.setItem(DISMISSED_KEY, appVersion);
}

/** A version split into up to three numeric parts, or null when it cannot be read. */
function parseVersion(value: string): number[] | null {
	const parts = value.trim().split(".");
	if (parts.length < 2 || parts.length > 3) return null;
	const numbers: number[] = [];
	for (const part of parts) {
		if (part === "") return null;
		const number = Number(part);
		if (!Number.isInteger(number) || number < 0) return null;
		numbers.push(number);
	}
	return numbers;
}

/** True when the Mac's version is older than the minimum, false when it is not, null when unreadable. */
export function isMacosVersionBelow(osVersion: string, minimum: string): boolean | null {
	const left = parseVersion(osVersion);
	const right = parseVersion(minimum);
	if (left === null || right === null) return null;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const a = left[index] ?? 0;
		const b = right[index] ?? 0;
		if (a !== b) return a < b;
	}
	return false;
}

export function MacosVersionWarning({
	system,
	minimumOsVersion,
	dismissed,
	onDismiss,
}: MacosVersionWarningProps) {
	if (dismissed) return null;
	const below = isMacosVersionBelow(system.osVersion, minimumOsVersion);
	if (below !== true) return null;
	return (
		<div
			data-tone="warning"
			className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-surface px-2 py-1.5 text-warning-fg"
		>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium">macOS {system.osVersion} is too old</p>
				<p className="text-xs text-warning-fg">
					Conducted needs macOS {minimumOsVersion} or newer.
				</p>
			</div>
			<button
				type="button"
				aria-label="Dismiss macOS version warning"
				onClick={onDismiss}
				className="-mr-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-sm text-warning-fg hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
			>
				<span aria-hidden="true">×</span>
			</button>
		</div>
	);
}

/** Reads the machine and the dismissal, then draws the warning when it applies. */
export function MacosVersionWarningNotice() {
	const container = useServices();
	// A hand-built container in an older test may not carry the Platform; there is nothing to read then.
	const platform = (container as { platform?: Platform }).platform;
	const [system, setSystem] = useState<SystemInfo | null>(null);
	const [dismissedVersion, setDismissedVersion] = useState(() => readMacosWarningDismissed());

	useEffect(() => {
		if (platform === undefined) return;
		let current = true;
		void platform.system.info().then(
			(info) => {
				if (current) setSystem(info);
			},
			(cause: unknown) => {
				if (!current) return;
				platform.app.writeLog("warn", "The Mac's system information could not be read", {
					message: cause instanceof Error ? cause.message : String(cause),
				});
			},
		);
		return () => {
			current = false;
		};
	}, [platform]);

	if (platform === undefined || system === null) return null;
	const dismissed = dismissedVersion === platform.app.version;
	return (
		<MacosVersionWarning
			system={system}
			minimumOsVersion={MINIMUM_MACOS_VERSION}
			dismissed={dismissed}
			onDismiss={() => {
				dismissMacosVersionWarning(platform.app.version);
				setDismissedVersion(platform.app.version);
			}}
		/>
	);
}
