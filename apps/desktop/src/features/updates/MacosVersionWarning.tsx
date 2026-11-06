/**
 * @feature APP-08 macOS version warning
 * Owns: the dismissible warning in the sidebar footer when the Mac's macOS version is too old for the app.
 * Behaviour: ui-map.md 1.3 (status areas: "macOS version warning with dismiss button"), 4.8 (sidebar
 * footer); coverage/inventory-controls.md (the dismiss button has the aria label "Dismiss macOS version
 * warning").
 * Data: `SystemInfo.osVersion` from useSystemInfo (core/hooks/system.ts, PLAT-32), the one reader of the
 * machine facts. The oldest supported version is `MINIMUM_MACOS_VERSION`, passed in so the check can be
 * tested.
 * Our design choice: the app supports macOS 14 and newer, the first version whose system `trash` command the
 * app relies on. The minimum is our constant, not the bundle's `minimumSystemVersion`: macOS refuses to open
 * an app below that value, so this warning could never show. The dismissal is kept in the web view's storage
 * under one key, holding the app version that was dismissed, so a later update that raises the minimum shows
 * the warning again. The warning uses the warning colour tokens, a function-only state, and sits above the
 * update notice.
 * Must handle: a version string with two or three parts ("15.4", "15.4.1"); a version that cannot be read
 * (no warning); system facts that cannot be read (no warning); a Mac at exactly the minimum (no warning);
 * dismissal remembered across restarts; storage that cannot be read (treated as not dismissed); a dismissal
 * that cannot be saved (an error toast, and the warning stays hidden for this run).
 * Test first: osVersion "13.6.1" with minimum "14.0" shows the warning; "14.0" shows nothing; dismissing
 * hides it.
 */
import { appError, err, messageOf, ok, type Result } from "@conducted/shared";
import { useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useSystemInfo } from "../../core/hooks.ts";
import type { SystemInfo } from "../../core/model.ts";
import { toastError } from "../../ui/Toast.tsx";

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

/** The web view's storage. Reaching it can throw, for example when storage is turned off. */
function browserStorage(): Result<WarningStorage> {
	try {
		return ok(window.localStorage);
	} catch (cause) {
		return err(appError("storage_unavailable", messageOf(cause), cause));
	}
}

/** The stored app version whose warning was dismissed, null when none was, or why it cannot be read. */
export function readMacosWarningDismissed(
	storage: () => Result<WarningStorage> = browserStorage,
): Result<string | null> {
	const opened = storage();
	if (!opened.ok) return opened;
	try {
		return ok(opened.value.getItem(DISMISSED_KEY));
	} catch (cause) {
		return err(appError("storage_read_failed", messageOf(cause), cause));
	}
}

/** Remembers the app version the user dismissed, so the warning returns after an update. */
export function dismissMacosVersionWarning(
	appVersion: string,
	storage: () => Result<WarningStorage> = browserStorage,
): Result<void> {
	const opened = storage();
	if (!opened.ok) return opened;
	try {
		opened.value.setItem(DISMISSED_KEY, appVersion);
		return ok(undefined);
	} catch (cause) {
		return err(appError("storage_write_failed", messageOf(cause), cause));
	}
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
	const { platform } = useServices();
	const system = useSystemInfo();
	// Storage that cannot be read counts as "not dismissed": the warning shows, which is the safe side.
	const [dismissedVersion, setDismissedVersion] = useState(() => {
		const read = readMacosWarningDismissed();
		return read.ok ? read.value : null;
	});

	if (system.state !== "ready") return null;
	const appVersion = platform.app.version;
	return (
		<MacosVersionWarning
			system={system.data}
			minimumOsVersion={MINIMUM_MACOS_VERSION}
			dismissed={dismissedVersion === appVersion}
			onDismiss={() => {
				const saved = dismissMacosVersionWarning(appVersion);
				if (!saved.ok) {
					toastError("Couldn't remember that you dismissed the macOS warning", saved.error);
				}
				setDismissedVersion(appVersion);
			}}
		/>
	);
}
