/**
 * @feature PLAT-01 In-memory Platform for tests
 * Owns: a complete `Platform` that keeps everything in memory, plus handles ("controls") that let
 * a test script what the outside world does: shell answers, sidecar lines, clicks, deep links.
 * Behaviour: services-map.md 1.1 (the Platform object is the only boundary, so a stand-in is
 * possible); docs/plans/scaffold.md decision on tests that "never mock what they test".
 * Must handle: it passes the same contract as the Tauri implementation (contract.ts), so a
 * service test on it is a statement about the real app; time and ids come from the options,
 * never from globals; every listener it hands out can be removed, and `dispose()` checks that none
 * is left (a leaked listener is a test failure); the database is a real SQLite passed in by the
 * test (for example a thin adapter over `node:sqlite`), because a fake database would test the
 * fake; the shell answers only what a test scripted, and an unscripted command is an `Err` with
 * code `shell_unscripted`, never a made-up success; the file system keeps text only, with
 * folders as path prefixes.
 * Our design choice: the stand-in is a factory returning the Platform together with its controls,
 * so production code cannot reach the controls through the Platform type.
 * Test first: the contract case "fs: write then read returns the same text" passes on it.
 */

import type { Clock, IdSource } from "@conducted/shared";
import { notImplemented, type Result } from "@conducted/shared";
import type { Database, Platform, ShellCommand, ShellOutput } from "./platform.ts";

/** A scripted answer for a shell command. Return null when the script does not know the command. */
export type ShellScript = (command: ShellCommand) => Result<ShellOutput> | null;

export interface MemoryPlatformOptions {
	clock: Clock;
	ids: IdSource;
	/** A real SQLite handle, already migrated by the test. */
	database: Database;
	version?: string;
	channel?: "dev" | "release";
	home?: string;
	appData?: string;
	temp?: string;
	resources?: string;
}

export interface MemoryPlatformControls {
	/** Replaces the shell script. Later scripts are tried first. */
	scriptShell(script: ShellScript): void;
	/** Every command given to `shell.run` and `shell.start`, in order. */
	readonly shellCalls: readonly ShellCommand[];
	/** Text files by absolute path. Reading and writing through `fs` use this map. */
	readonly files: Map<string, string>;
	/** Lines the app sent to the sidecar, in order. */
	readonly sidecarSent: readonly string[];
	/** Delivers a line to `sidecar.onLine` listeners. */
	emitSidecarLine(line: string): void;
	emitSidecarRestart(): void;
	/** Delivers a notification click and a deep link. */
	emitNotificationClick(deepLink: string): void;
	emitDeepLink(url: string): void;
	emitQuitRequested(): void;
	/** Notifications shown and the last dock badge. */
	readonly notificationsShown: readonly { title: string; body: string; deepLink?: string }[];
	readonly dockBadge: number | null;
	/** The last text written to the clipboard. */
	readonly clipboardText: string | null;
	/** Answers for dialogs, consumed in order. */
	queueDialogAnswers(answers: {
		folder?: string | null;
		files?: string[];
		confirm?: boolean;
	}): void;
	/** Secrets by key. */
	readonly secrets: Map<string, string>;
	/** Log lines written through `app.writeLog`. */
	readonly logs: readonly { level: string; message: string }[];
	/** Throws when a listener handed out by the Platform was never unsubscribed. */
	dispose(): void;
}

export interface MemoryPlatform {
	platform: Platform;
	controls: MemoryPlatformControls;
}

export function createMemoryPlatform(_options: MemoryPlatformOptions): MemoryPlatform {
	return notImplemented("PLAT-01");
}
