/**
 * @feature PLAT-21 Keep the Mac awake while agents work; RC-04 Remote Control settings
 * Owns: running `caffeinate` while either rule holds, and stopping it when neither does. Rule 1
 * (PLAT-21): the setting `caffeinate_while_agents_running` is on and at least one chat is working,
 * unless the battery is at 10 percent or less while on battery. Rule 2 (RC-04): the setting
 * `remote_control_keep_awake` is on, a chat's Remote Control session is connected, and the Mac is
 * not on battery (Conductor's rule for a connected remote-control device).
 * Behaviour: services-map.md 5B.2 (rules 5B.2.1 and 5B.2.7: a manager reacts to the setting and to
 * agent work, and scans every 10 seconds), part 6 (startup), native-and-sidecar-map.md A5.
 * `platform.ts` has no keep-awake door: this service starts `caffeinate` through `shell.start`.
 * Must handle: the setting turning off while `caffeinate` runs (cancel it at once); a scan while
 * the process is already running (no second process); `caffeinate` that exits by itself (the next
 * scan starts it again when the rules still say yes); a battery reading that cannot be parsed (keep
 * the current state and return the error, never guess a percentage); a Mac with no battery (no
 * reading, so the battery rule does not apply); the app quitting (stop cancels the process).
 * Our design choice: the service has no timer. The composition root (`container.ts`) calls `scan`
 * every `KEEP_AWAKE_SCAN_MS` and whenever a setting, a chat's work or a chat's Remote Control
 * link changes, so tests never
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
/** The Remote Control keep-awake setting's registry key (RC-04). */
export const REMOTE_KEEP_AWAKE_SETTING_KEY: SettingKey = "remote_control_keep_awake";

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
	/** The setting `remote_control_keep_awake` (RC-04). */
	remoteKeepAwake: boolean;
	/** True while a chat's Remote Control session is connected. */
	remoteConnected: boolean;
	/** Null on a Mac without a battery. */
	battery: BatteryReading | null;
}

/**
 * The rules. Agents: awake when enabled, a chat works, and the battery is not low while on battery.
 * Remote Control: awake when its setting is on, a session is connected, and the Mac is plugged in.
 */
export function shouldKeepAwake(input: KeepAwakeInput): boolean {
	const onBattery = input.battery?.onBattery === true;
	const lowBattery =
		input.battery !== null && onBattery && input.battery.percent <= KEEP_AWAKE_MIN_BATTERY_PERCENT;
	const forAgents = input.enabled && input.chatWorking && !lowBattery;
	const forRemote = input.remoteKeepAwake && input.remoteConnected && !onBattery;
	return forAgents || forRemote;
}

/** Whether a rule could hold before the battery is read, so a scan with none reads nothing. */
function mayKeepAwake(input: Omit<KeepAwakeInput, "battery">): boolean {
	return (input.enabled && input.chatWorking) || (input.remoteKeepAwake && input.remoteConnected);
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
	/** True while any chat's Remote Control session is connected (RC-04). */
	anyRemoteControlConnected: () => boolean;
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
		if (!mayKeepAwake(this.#inputs())) {
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

		// The settings, the chats or the Remote Control sessions may have changed while `pmset` ran.
		if (!shouldKeepAwake({ ...this.#inputs(), battery: battery.value })) {
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

	#inputs(): Omit<KeepAwakeInput, "battery"> {
		return {
			enabled: this.#deps.setting<boolean>(KEEP_AWAKE_SETTING_KEY) === true,
			chatWorking: this.#deps.anyChatWorking(),
			remoteKeepAwake: this.#deps.setting<boolean>(REMOTE_KEEP_AWAKE_SETTING_KEY) === true,
			remoteConnected: this.#deps.anyRemoteControlConnected(),
		};
	}

	async #cancel(): Promise<void> {
		const running = this.#running;
		this.#running = null;
		if (running !== null) await running.cancel();
	}
}
