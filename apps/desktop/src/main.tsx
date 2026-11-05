/**
 * @feature APP-01 Startup sequence
 * Owns: the web UI entry. Builds the Platform, the query client, the service container and the router,
 * then runs the ordered start from app/startup.ts and mounts the first screen.
 * Behaviour: services-map.md part 6 (phase 1 builds the Platform; phase 2 renders the root with React
 * error handlers; phase 3 runs the gated bootstrap, with settings first and the sidecar last).
 * Our design choice: `startApp` takes the already-built Platform, so a test can mount the entry on the
 * in-memory Platform. The module wires the Tauri Platform and calls it once when `index.html` has a
 * `#root`; importing the module in a test does not start a second app.
 * Must handle: a Platform that cannot be built (logged, no root mounted); a startup state that is
 * blocked or failed (logged with its phase and sidecar log path; the designed screens are APP-08);
 * query and mutation failures, React render failures and unhandled errors all reaching the app log;
 * the toast host inside the providers; one query client for the whole app.
 * Test first: mounting the entry builds a container, runs the startup sequence and renders the router.
 */
import { cryptoIds, type Result, systemClock } from "@conducted/shared";
import type { QueryClient } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders, createQueryClient, createRootErrorHandlers } from "./app/providers.tsx";
import { AppRoutes, createAppRouter } from "./app/router.tsx";
import { runStartup, type StartupState } from "./app/startup.ts";
import { type Container, type ContainerInputs, createContainer } from "./core/container.ts";
import { ServicesProvider } from "./core/context.tsx";
import { parseDeepLink, type SoundPlayer } from "./core/services/notifications.ts";
import { tomlCodec } from "./core/services/toml-codec.ts";
import type { PlaceNames } from "./core/services/workspace.ts";
import type { Platform } from "./platform/platform.ts";
import { createTauriPlatform } from "./platform/tauri.ts";
import "./styles.css";

/** Our own place names for new workspaces. A name already used gets the next one in the list. */
const PLACE_NAMES = [
	"arbor",
	"beacon",
	"canyon",
	"delta",
	"ember",
	"fjord",
	"grove",
	"harbor",
	"islet",
	"jasper",
	"kelp",
	"lagoon",
	"meadow",
	"nimbus",
	"orchard",
	"prairie",
	"quarry",
	"ridge",
	"summit",
	"tundra",
	"upland",
	"valley",
	"willow",
	"xenon",
	"yarrow",
	"zenith",
];

const placeNames: PlaceNames = {
	pick(taken) {
		const free = PLACE_NAMES.find((name) => !taken.has(name));
		if (free !== undefined) return free;
		let index = PLACE_NAMES.length;
		while (taken.has(`place-${index}`)) index += 1;
		return `place-${index}`;
	},
};

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
	options: Pick<StartAppOptions, "platform" | "openLink">,
): Container {
	const inputs: ContainerInputs = {
		platform: options.platform,
		clock: systemClock,
		ids: cryptoIds,
		toml: tomlCodec,
		placeNames,
		sound,
		windowFocused: () => document.hasFocus(),
		...(options.openLink === undefined ? {} : { openLink: options.openLink }),
	};
	return createContainer(inputs);
}

/**
 * Opens a notification click. Notifications carry a `conducted://workspace` link, which is the one
 * deep link the app entry owns; every other link goes to the command dispatcher (NAV-14).
 */
function openWorkspaceLink(
	container: Container,
	router: ReturnType<typeof createAppRouter>,
	platform: Platform,
	url: string,
): void {
	const link = parseDeepLink(url);
	if (link === null) {
		platform.app.writeLog("warn", `A notification link could not be read: ${url}`);
		return;
	}
	const workspace = container.services.workspace.store.getState().workspacesById[link.workspaceId];
	if (workspace === undefined) {
		platform.app.writeLog(
			"warn",
			`A notification link names a workspace that is not loaded: ${link.workspaceId}`,
		);
		return;
	}
	void router.navigate({
		to: "/repository/$repositoryId/workspace/$workspaceId",
		params: { repositoryId: workspace.repoId, workspaceId: link.workspaceId },
		search: link.sessionId === null ? {} : { sessionId: link.sessionId },
	});
}

export interface StartAppOptions {
	root: HTMLElement;
	platform: Platform;
	/** Opens a notification click. Deep links are the command dispatcher's (NAV-14). */
	openLink?: (url: string) => void;
	/** Installs the process-wide error and drag-and-drop handlers. On unless a test says otherwise. */
	installHandlers?: boolean;
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
	const router = createAppRouter();
	let openedContainer: Container | null = null;
	const openLink =
		options.openLink ??
		((url: string) => {
			if (openedContainer === null) return;
			openWorkspaceLink(openedContainer, router, platform, url);
		});
	const container = createAppContainer({ platform, openLink });
	openedContainer = container;

	const report = (state: StartupState): void => {
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
					<AppRoutes router={router} />
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
