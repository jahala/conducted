/**
 * @feature PLAT-21 Keep the Mac awake while agents work
 * Owns: running `caffeinate` while the setting `caffeinate_while_agents_running` is on and at
 * least one chat is working, and stopping it when the work ends, the setting is turned off, or
 * the battery falls below 10 percent.
 * Behaviour: services-map.md 5B.2 (rules 5B.2.1 and 5B.2.7: a manager reacts to the setting and to
 * agent work, and scans every 10 seconds), part 6 (startup), native-and-sidecar-map.md A5.
 * `platform.ts` has no keep-awake door: this service starts `caffeinate` through `shell.start`.
 * Must handle: the setting turning off while `caffeinate` runs (cancel it at once); a scan while
 * the process is already running (no second process); `caffeinate` that exits by itself (the next
 * scan starts it again when the rules still say yes); a battery reading that cannot be parsed (keep
 * the current state and return the error, never guess a percentage); a Mac with no battery (no
 * reading, so the battery rule does not apply); the app quitting (stop cancels the process).
 * Our design choice: the service has no timer. The composition root calls `scan` every
 * `KEEP_AWAKE_SCAN_MS` and whenever a chat starts or stops working, so tests never wait.
 * Test first: with the setting on and a chat working, `scan` starts exactly one `caffeinate`;
 * when the battery reads 9 percent, the next `scan` cancels it.
 */
import { notImplemented, type Result } from "@conducted/shared";
import type { Platform } from "../../platform/platform.ts";

/** How often the root calls `scan`, from the research (10 seconds). */
export const KEEP_AWAKE_SCAN_MS = 10_000;
/** Below this battery level the Mac is allowed to sleep. */
export const KEEP_AWAKE_MIN_BATTERY_PERCENT = 10;

/** What `pmset -g batt` reported. */
export interface BatteryReading {
	percent: number;
	/** True while the Mac runs on its battery. */
	onBattery: boolean;
}

export interface KeepAwakeInput {
	/** The setting `caffeinate_while_agents_running`. */
	enabled: boolean;
	chatWorking: boolean;
	/** Null on a Mac without a battery. */
	battery: BatteryReading | null;
}

/** The rule: awake when enabled, a chat works, and the battery is not below the minimum. */
export function shouldKeepAwake(_input: KeepAwakeInput): boolean {
	return notImplemented("PLAT-21");
}

/** Reads `pmset -g batt` output. Null means the Mac has no battery. */
export function parseBattery(_pmsetOutput: string): Result<BatteryReading | null> {
	return notImplemented("PLAT-21");
}

export interface KeepAwakeDeps {
	/** `shell` runs `pmset` and `caffeinate`; `fs.paths.home` is their working folder. */
	platform: Pick<Platform, "shell" | "fs">;
	setting: <T>(key: string) => T;
	/** True while any chat is working. */
	anyChatWorking: () => boolean;
}

export class KeepAwakeService {
	readonly #deps: KeepAwakeDeps;

	constructor(deps: KeepAwakeDeps) {
		this.#deps = deps;
	}

	/** Applies the rule once: starts or cancels `caffeinate` to match it. */
	scan(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("PLAT-21");
	}

	/** Cancels `caffeinate` if it runs. Called when the app stops. */
	stop(): Promise<void> {
		return notImplemented("PLAT-21");
	}
}
