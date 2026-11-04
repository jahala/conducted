/**
 * @feature SIDE-18 Logger
 * Owns: the Logger interface every module receives as a parameter, a level filter, and secret
 * redaction for environment dumps.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 "Logging" and A6 step 10 (the sidecar
 * writes a log file; env values whose names look secret are replaced by a marker).
 * Must handle: the level can change at runtime (setLogLevel notification), a sink that throws must
 * not break the caller, redaction hides values but keeps key names, and no module logs a raw
 * secret.
 * Test first: with level "warn", info calls reach no sink and error calls reach it once.
 * Our design choice: the sink is a parameter. Writing to a file or to the logger mode's HTTP
 * server is the caller's choice, so modules never touch the file system to log.
 */
import type { Clock } from "@conducted/shared";

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogRecord {
	at: number;
	level: LogLevel;
	/** The module that logged, for example "session" or "runner:claude". */
	scope: string;
	message: string;
	data?: Record<string, unknown>;
}

/** Where records go. A sink must not throw; createLogger guards against it anyway. */
export type LogSink = (record: LogRecord) => void;

export interface Logger {
	error(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	debug(message: string, data?: Record<string, unknown>): void;
	/** A logger for a sub-module. The scope is appended with a colon. */
	child(scope: string): Logger;
	setLevel(level: LogLevel): void;
}

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export function isLevelEnabled(configured: LogLevel, wanted: LogLevel): boolean {
	return RANK[wanted] <= RANK[configured];
}

/** The level is shared between a logger and its children, so one setLevel call changes all. */
interface LevelCell {
	level: LogLevel;
}

export function createLogger(options: {
	sink: LogSink;
	clock: Clock;
	level: LogLevel;
	scope: string;
}): Logger {
	return build(options.sink, options.clock, { level: options.level }, options.scope);
}

function build(sink: LogSink, clock: Clock, cell: LevelCell, scope: string): Logger {
	const emit = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
		if (!isLevelEnabled(cell.level, level)) return;
		const record: LogRecord = { at: clock.now(), level, scope, message };
		if (data !== undefined) record.data = data;
		try {
			sink(record);
		} catch {
			// A failing sink must never break the code that logs.
		}
	};
	return {
		error: (message, data) => emit("error", message, data),
		warn: (message, data) => emit("warn", message, data),
		info: (message, data) => emit("info", message, data),
		debug: (message, data) => emit("debug", message, data),
		child: (childScope) => build(sink, clock, cell, `${scope}:${childScope}`),
		setLevel: (level) => {
			cell.level = level;
		},
	};
}

/** Names that look like secrets. Matched case-insensitively against environment variable names. */
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|PAT)$|^CONDUCTED_INTERNAL_/i;

/** Replaces the values of secret-looking variables with a marker that keeps only the length. */
export function redactEnv(env: Readonly<Record<string, string>>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		out[name] = SECRET_NAME.test(name) ? `<redacted:${value.length}>` : value;
	}
	return out;
}
