/**
 * @feature PLAT-21 Keep the Mac awake while agents work
 * Owns: running `caffeinate` while the setting `caffeinate_while_agents_running` is on and at
 * least one chat is working, and stopping it when the work ends, the setting is turned off, or
 * the battery falls to 10 percent or less while on battery.
 * Behaviour: services-map.md 5B.2 (rules 5B.2.1 and 5B.2.7: a manager reacts to the setting and to
 * agent work, and scans every 10 seconds), part 6 (startup), native-and-sidecar-map.md A5.
 * `platform.ts` has no keep-awake door: this service starts `caffeinate` through `shell.start`.
 * Must handle: the setting turning off while `caffeinate` runs (cancel it at once); a scan while
 * the process is already running (no second process); `caffeinate` that exits by itself (the next
 * scan starts it again when the rules still say yes); a battery reading that cannot be parsed (keep
 * the current state and return the error, never guess a percentage); a Mac with no battery (no
 * reading, so the battery rule does not apply); the app quitting (stop cancels the process).
 * Our design choice: the service has no timer. The composition root (`container.ts`) calls `scan`
 * every `KEEP_AWAKE_SCAN_MS` and whenever the setting or a chat's work changes, so tests never
 * wait. Overlapping scans share one run, so two calls can never start two processes. After `stop`
 * a later `scan` does nothing, so nothing can start `caffeinate` again as the app quits.
 * Test first: with the setting on and a chat working, `scan` starts exactly one `caffeinate`;
 * when the battery reads 9 percent, the next `scan` cancels it.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Platform, RunningCommand } from "../../platform/platform.ts";
import { createSingleFlight } from "../async/single-flight.ts";
import type { SettingKey } from "../registries/settings.ts";

/** How often the root calls `scan`, from the research (10 seconds). */
export const KEEP_AWAKE_SCAN_MS = 10_000;
/** On battery at or below this level the Mac is allowed to sleep. */
export const KEEP_AWAKE_MIN_BATTERY_PERCENT = 10;
/** The setting's registry key, typed from the registry so a rename there fails the typecheck. */
export const KEEP_AWAKE_SETTING_KEY: SettingKey = "caffeinate_while_agents_running";

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

/** The rule: awake when enabled, a chat works, and the battery is not low while on battery. */
export function shouldKeepAwake(input: KeepAwakeInput): boolean {
	if (!input.enabled || !input.chatWorking) return false;
	if (input.battery === null) return true;
	return !(input.battery.onBattery && input.battery.percent <= KEEP_AWAKE_MIN_BATTERY_PERCENT);
}

const BATTERY_LINE = /(?:Internal)?Battery-\d+/i;
const POWER_SOURCE = /Now drawing from '([^']+)'/i;
const PERCENT = /(\d{1,3})%/;

/** Reads `pmset -g batt` output. Null means the Mac has no battery. */
export function parseBattery(pmsetOutput: string): Result<BatteryReading | null> {
	const batteryLine = pmsetOutput.split(/\r?\n/).find((line) => BATTERY_LINE.test(line));
	if (batteryLine === undefined) return ok(null);

	const percentMatch = PERCENT.exec(batteryLine);
	if (percentMatch === null) return unreadableBattery();
	const percent = Number(percentMatch[1]);
	if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
		return unreadableBattery();
	}

	const source = (POWER_SOURCE.exec(pmsetOutput)?.[1] ?? "").toLowerCase();
	const status = batteryLine.toLowerCase();
	let onBattery: boolean;
	if (source.includes("battery")) onBattery = true;
	else if (source.includes("ac power")) onBattery = false;
	else if (status.includes("discharging")) onBattery = true;
	else if (/\b(charging|charged|finishing charge)\b/.test(status)) onBattery = false;
	else return unreadableBattery();

	return ok({ percent, onBattery });
}

const unreadableBattery = (): Result<never> =>
	err(appError("battery_unreadable", "The battery level could not be read from pmset."));

export interface KeepAwakeDeps {
	/** `shell` runs `pmset` and `caffeinate`; `fs.paths.home` is their working folder. */
	platform: Pick<Platform, "shell" | "fs">;
	setting: <T>(key: string) => T;
	/** True while any chat is working. */
	anyChatWorking: () => boolean;
}

export class KeepAwakeService {
	readonly #deps: KeepAwakeDeps;
	readonly #scans = createSingleFlight<"scan">();
	#running: RunningCommand | null = null;
	#generation = 0;
	#stopped = false;

	constructor(deps: KeepAwakeDeps) {
		this.#deps = deps;
	}

	/** Applies the rule once: starts or cancels `caffeinate` to match it. */
	scan(): Promise<Result<void>> {
		if (this.#stopped) return Promise.resolve(ok(undefined));
		return this.#scans.run("scan", () => this.#apply());
	}

	/** Cancels `caffeinate` if it runs. Called when the app stops. */
	async stop(): Promise<void> {
		this.#stopped = true;
		this.#generation += 1;
		await this.#cancel();
	}

	async #apply(): Promise<Result<void>> {
		const generation = this.#generation;
		const enabled = this.#deps.setting<boolean>(KEEP_AWAKE_SETTING_KEY) === true;
		const chatWorking = this.#deps.anyChatWorking();
		if (!enabled || !chatWorking) {
			await this.#cancel();
			return ok(undefined);
		}

		const output = await this.#deps.platform.shell.run({
			program: "pmset",
			args: ["-g", "batt"],
			cwd: this.#deps.platform.fs.paths.home,
		});
		// A scan that was interrupted by `stop` must not start a process after it.
		if (generation !== this.#generation) return ok(undefined);
		if (!output.ok) return output;

		const battery = parseBattery(output.value.stdout);
		if (!battery.ok) return battery;

		// The setting or the chats may have changed while `pmset` ran.
		const stillEnabled = this.#deps.setting<boolean>(KEEP_AWAKE_SETTING_KEY) === true;
		const stillWorking = this.#deps.anyChatWorking();
		if (!stillEnabled || !stillWorking) {
			await this.#cancel();
			return ok(undefined);
		}

		if (
			!shouldKeepAwake({ enabled: stillEnabled, chatWorking: stillWorking, battery: battery.value })
		) {
			await this.#cancel();
			return ok(undefined);
		}
		if (this.#running !== null) return ok(undefined);

		const running = this.#deps.platform.shell.start({
			program: "caffeinate",
			args: ["-i"],
			cwd: this.#deps.platform.fs.paths.home,
		});
		this.#running = running;
		const clear = (): void => {
			if (this.#running === running) this.#running = null;
		};
		// The exit result does not change the rule. Clearing the process lets the next scan
		// start caffeinate again, which also retries a launch that failed.
		void running.done.then(clear, clear);
		return ok(undefined);
	}

	async #cancel(): Promise<void> {
		const running = this.#running;
		this.#running = null;
		if (running !== null) await running.cancel();
	}
}
