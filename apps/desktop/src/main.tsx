/**
 * @feature APP-01 Startup sequence
 * Owns: the web UI entry. Builds the Platform, the query client, the service container and the router,
 * then runs the ordered start from app/startup.ts and mounts the first screen.
 * Behaviour: services-map.md part 6 (phase 1 builds the Platform; phase 2 renders the root with React
 * error handlers; phase 3 runs the gated bootstrap, with settings first and the sidecar last).
 * Our design choice: `startApp` takes the already-built Platform, so a test can mount the entry on the
 * in-memory Platform. The clock, the id source and the router history default to the system's and may
 * be passed in, so the states catalogue (src/catalogue) draws the same screen on every run. The module
 * wires the Tauri Platform and calls it once when `index.html` has a `#root`; importing the module in a
 * test does not start a second app.
 * Must handle: a Platform that cannot be built (logged, no root mounted); the loading, blocked, failed and
 * wrong-CPU states drawn by APP-08's StartupScreen and StartupFailure (the blocked and failed states are also
 * logged); query and mutation failures, React render failures and unhandled errors all reaching the app log;
 * the toast host inside the providers; one query client for the whole app; a notification click opened
 * through NAV-17's deep-link opener, the same one Platform deep links use.
 * Test first: mounting the entry builds a container, runs the startup sequence and renders the router.
 */
import {
	type Clock,
	cryptoIds,
	type IdSource,
	messageOf,
	type Result,
	systemClock,
} from "@conducted/shared";
import type { QueryClient } from "@tanstack/react-query";
import type { RouterHistory } from "@tanstack/react-router";
import { StrictMode, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createDeepLinkOpener } from "./app/deep-link-routes.ts";
import { AppProviders, createQueryClient, createRootErrorHandlers } from "./app/providers.tsx";
import { AppRoutes, createAppRouter } from "./app/router.tsx";
import { type StartupBlocker, StartupFailure } from "./app/StartupFailure.tsx";
import { StartupScreen } from "./app/StartupScreen.tsx";
import { runStartup, type StartupState } from "./app/startup.ts";
import { type Container, type ContainerInputs, createContainer } from "./core/container.ts";
import { ServicesProvider } from "./core/context.tsx";
import { useSystemInfo } from "./core/hooks.ts";
import type { SoundPlayer } from "./core/services/notifications.ts";
import { tomlCodec } from "./core/services/toml-codec.ts";
import { createPlaceNames } from "./core/services/workspace.ts";
import { writeRedactedReport } from "./features/diagnostics/diagnostics-report.ts";
import { isWrongCpuBuild } from "./features/updates/RosettaConfirm.tsx";
import type { Platform, SystemInfo } from "./platform/platform.ts";
import { createTauriPlatform } from "./platform/tauri.ts";
import { toastError } from "./ui/Toast.tsx";
import "./styles.css";

/**
 * Where the Apple silicon build is published: the latest GitHub release of this repository, the place
 * `pnpm release` tags (scripts/release.ts builds only the Apple silicon app). The wrong-CPU screen opens it.
 */
const APPLE_SILICON_DOWNLOAD_URL = "https://github.com/jahala/conducted/releases/latest";

/**
 * Plays our own two-tone chime with the Web Audio API. The two sound choices and the notification
 * settings that pick one live in `core/services/notifications.ts` and the settings registry.
 */
const sound: SoundPlayer = {
	async play(soundId) {
		if (soundId === "none" || soundId === "disabled") return;
		const AudioContextClass =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (AudioContextClass === undefined) return;
		const context = new AudioContextClass();
		try {
			const now = context.currentTime;
			for (const [frequency, offset] of [
				[880, 0],
				[660, 0.14],
			] as const) {
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				oscillator.type = "sine";
				oscillator.frequency.value = frequency;
				gain.gain.setValueAtTime(0.5, now + offset);
				gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.3);
				oscillator.connect(gain).connect(context.destination);
				oscillator.start(now + offset);
				oscillator.stop(now + offset + 0.3);
			}
			await new Promise<void>((resolve) => setTimeout(resolve, 500));
		} finally {
			await context.close();
		}
	},
};

/** Builds one container from a Platform, with the real ports the entry owns. */
export function createAppContainer(
	options: Pick<StartAppOptions, "platform" | "openLink" | "clock" | "ids">,
): Container {
	const inputs: ContainerInputs = {
		platform: options.platform,
		clock: options.clock ?? systemClock,
		ids: options.ids ?? cryptoIds,
		toml: tomlCodec,
		placeNames: createPlaceNames(),
		sound,
		windowFocused: () => document.hasFocus(),
		...(options.openLink === undefined ? {} : { openLink: options.openLink }),
		writeDiagnosticsReport: (capture, fileName) =>
			writeRedactedReport(options.platform, capture, fileName),
	};
	return createContainer(inputs);
}

/** The start-up screen state, plus the wrong-CPU blocker that needs the machine facts. */
type StartupView = StartupState | { kind: "wrong_cpu_build"; system: SystemInfo };

interface StartupChannel {
	read(): StartupView;
	write(state: StartupView): void;
	subscribe(listener: () => void): () => void;
}

/** A tiny store bridge, so the start-up sequence outside React can drive the screen inside it. */
function createStartupChannel(initial: StartupView): StartupChannel {
	let current = initial;
	const listeners = new Set<() => void>();
	return {
		read: () => current,
		write: (state) => {
			current = state;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/** Checks for an update, and shows the failure instead of leaving the button silent. */
function checkForUpdates(container: Container): void {
	let checking: Promise<Result<void>>;
	try {
		checking = container.actions.app.checkForUpdates();
	} catch (cause) {
		toastError("Couldn't check for updates", { message: messageOf(cause) });
		return;
	}
	void checking
		.then((outcome) => {
			if (!outcome.ok) toastError("Couldn't check for updates", outcome.error);
		})
		.catch((cause: unknown) => {
			toastError("Couldn't check for updates", { message: messageOf(cause) });
		});
}

/** The text "Copy diagnostics" writes. It never leaves the Mac by itself. */
function blockerDiagnostics(blocker: StartupBlocker, appVersion: string): string {
	const lines = [`Conducted ${appVersion}`];
	if (blocker.kind === "blocked") {
		lines.push(
			`The database schema is ${blocker.databaseVersion}; this app supports up to ${blocker.appVersion}.`,
			"The database was created by a newer version of Conducted.",
		);
	}
	if (blocker.kind === "failed") {
		lines.push(
			`Start-up failed during ${blocker.phase}: ${blocker.message}`,
			blocker.logPath === null ? "No log file path was available." : `Log file: ${blocker.logPath}`,
		);
	}
	if (blocker.kind === "wrong_cpu_build") {
		lines.push(
			`macOS ${blocker.system.osVersion}; Mac ${blocker.system.machineArch}; build ${blocker.system.buildArch}.`,
		);
	}
	return lines.join("\n");
}

function copyDiagnostics(container: Container, blocker: StartupBlocker): void {
	const text = blockerDiagnostics(blocker, container.platform.app.version);
	void container.actions.app.copyText(text).then((outcome) => {
		if (!outcome.ok) toastError("Couldn't copy diagnostics", outcome.error);
	});
}

/**
 * Draws the start-up screen, the blocker screen, or the router, from the same channel. A wrong-CPU build gets
 * the full-screen blocker once the machine facts are known; "Continue anyway" mounts the app for this run.
 */
function StartupRoot({
	channel,
	container,
	router,
}: {
	channel: StartupChannel;
	container: Container;
	router: ReturnType<typeof createAppRouter>;
}) {
	const state = useSyncExternalStore(channel.subscribe, channel.read, channel.read);
	const system = useSystemInfo();
	const [continuedWrongCpu, setContinuedWrongCpu] = useState(false);

	if (state.kind === "running") return <StartupScreen phase={state.phase} />;
	if (state.kind === "ready") {
		if (!continuedWrongCpu && system.state === "ready" && isWrongCpuBuild(system.data)) {
			const blocker: StartupBlocker = { kind: "wrong_cpu_build", system: system.data };
			return (
				<StartupFailure
					blocker={blocker}
					onUpdate={() => checkForUpdates(container)}
					onRetry={() => window.location.reload()}
					onCopyDiagnostics={() => copyDiagnostics(container, blocker)}
					onQuit={() => {
						void container.platform.app.quit();
					}}
					onContinueAnyway={() => setContinuedWrongCpu(true)}
					downloadUrl={APPLE_SILICON_DOWNLOAD_URL}
				/>
			);
		}
		return <AppRoutes router={router} />;
	}
	const blocker = state;
	return (
		<StartupFailure
			blocker={blocker}
			onUpdate={() => checkForUpdates(container)}
			onRetry={() => window.location.reload()}
			onCopyDiagnostics={() => copyDiagnostics(container, blocker)}
			onQuit={() => {
				void container.platform.app.quit();
			}}
		/>
	);
}

export interface StartAppOptions {
	root: HTMLElement;
	platform: Platform;
	/**
	 * Opens a notification click. By default NAV-17's deep-link opener, the same one the command
	 * dispatcher hands Platform deep links to. A test may pass its own.
	 */
	openLink?: (url: string) => void;
	/** Installs the process-wide error and drag-and-drop handlers. On unless a test says otherwise. */
	installHandlers?: boolean;
	/** The time source. The system clock unless a caller passes its own. */
	clock?: Clock;
	/** The id source. Random ids unless a caller passes its own. */
	ids?: IdSource;
	/** The router history. The browser's unless a caller passes its own, such as a memory history. */
	history?: RouterHistory;
}

export interface StartedApp {
	container: Container;
	queryClient: QueryClient;
	router: ReturnType<typeof createAppRouter>;
	/** Resolves when the ordered start ends, with the same result `runStartup` returns. */
	started: Promise<Result<void>>;
	/** Removes the mounted root. */
	unmount: () => void;
}

/** Mounts the app root and starts the sequence behind it. Returns the live pieces for a test. */
export function startApp(options: StartAppOptions): StartedApp {
	const { platform } = options;
	const log = (message: string, data?: unknown): void =>
		platform.app.writeLog("error", message, data);

	const queryClient = createQueryClient((message, data) =>
		platform.app.writeLog("error", message, data),
	);
	const rootErrorHandlers = createRootErrorHandlers((message, data) =>
		platform.app.writeLog("error", message, data),
	);
	const router = createAppRouter(options.history);
	let openedContainer: Container | null = null;
	const openLink =
		options.openLink ??
		((url: string) => {
			if (openedContainer === null) return;
			createDeepLinkOpener(openedContainer, router.navigate)(url);
		});
	const container = createAppContainer({
		platform,
		openLink,
		clock: options.clock,
		ids: options.ids,
	});
	openedContainer = container;

	const startupChannel = createStartupChannel({ kind: "running", phase: "database" });
	const report = (state: StartupState): void => {
		startupChannel.write(state);
		if (state.kind === "blocked") {
			log("Startup blocked: the database is newer than this app", {
				databaseVersion: state.databaseVersion,
				appVersion: state.appVersion,
			});
		}
		if (state.kind === "failed") {
			log(`Startup failed during ${state.phase}`, {
				message: state.message,
				logPath: state.logPath,
			});
		}
	};

	const root = createRoot(options.root, rootErrorHandlers);
	root.render(
		<StrictMode>
			<AppProviders client={queryClient}>
				<ServicesProvider container={container}>
					<StartupRoot channel={startupChannel} container={container} router={router} />
				</ServicesProvider>
			</AppProviders>
		</StrictMode>,
	);

	const started = runStartup(container, report, {
		installHandlers: options.installHandlers ?? true,
	});
	return { container, queryClient, router, started, unmount: () => root.unmount() };
}

const rootElement = typeof document === "undefined" ? null : document.getElementById("root");

if (rootElement !== null) {
	void (async () => {
		const platform = await createTauriPlatform();
		if (!platform.ok) {
			console.error(`Conducted could not start: ${platform.error.message}`, platform.error);
			return;
		}
		startApp({ root: rootElement, platform: platform.value });
	})();
}
