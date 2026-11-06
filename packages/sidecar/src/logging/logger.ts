/**
 * @feature SIDE-18 Logger
 * Owns: the Logger interface every module receives as a parameter, a level filter, folding for
 * repeated error lines, secret redaction of log data, and the console reroute.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 "Logging", A6 step 10 and D026: the
 * sidecar writes one JSON object per line to stderr. The Rust launcher (PLAT-09) writes that
 * stderr to `<app data>/logs/sidecar-<pid>.log`, and the log export includes the file. Routing
 * these lines into the app log files with a sidecar tag, as D026 plans, is not built yet; that
 * item stays open on SIDE-18.
 * Must handle: the level can change at runtime (setLogLevel notification), a sink that throws must
 * not break the caller, redaction hides values but keeps key names, at any depth of a record's
 * data (the composition root's stderr sink redacts every record, so no module's line leaves the
 * process with a raw secret under a secret-looking name), an error line repeated many times is
 * written once with its count after 5 s of quiet (60 s at most or 1000 repeats), at most 1000
 * distinct error messages are tracked, and console calls reach the logger instead of stderr.
 * Our design choice: a name is secret-looking when its last word (split at `_`, `-`, `.` and
 * camelCase) is token, secret, password, passwd, credential(s), authorization, cookie or apikey, or
 * is key or pat after another word (ANTHROPIC_API_KEY, GH_PAT), or when it starts with
 * CONDUCTED_INTERNAL_. A bare `key` (a process key, a cache key) and REACT_COMPAT stay visible.
 * Test first: with level "warn", info calls reach no sink and error calls reach it once.
 * Our design choice: the sink is a parameter, so modules never touch the file system to log. The
 * composition root asks for folding and the console reroute; a test can pass its own clock and
 * timer source.
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
	/** Writes pending folded lines and restores a rerouted console. Safe to call twice. */
	dispose?(): void;
}

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export function isLevelEnabled(configured: LogLevel, wanted: LogLevel): boolean {
	return RANK[wanted] <= RANK[configured];
}

/** The level is shared between a logger and its children, so one setLevel call changes all. */
interface LevelCell {
	level: LogLevel;
}

/** Runs a function after a delay. The returned function cancels it. */
export interface RepeatScheduler {
	after(ms: number, fn: () => void): () => void;
}

export interface LoggerOptions {
	sink: LogSink;
	clock: Clock;
	level: LogLevel;
	scope: string;
	/** Fold repeated error lines. Off unless the composition root asks for it. */
	foldRepeats?: boolean;
	/** Route console calls into this logger. Off unless the composition root asks for it. */
	rerouteConsole?: boolean;
}

export function createLogger(options: LoggerOptions): Logger {
	const folder = options.foldRepeats
		? createRepeatFolder(options.sink, { clock: options.clock })
		: null;
	const sink = folder?.sink ?? options.sink;
	let restoreConsole: (() => void) | null = null;
	let disposed = false;
	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		restoreConsole?.();
		folder?.dispose();
	};
	const logger = build(sink, options.clock, { level: options.level }, options.scope, dispose);
	if (options.rerouteConsole === true) {
		restoreConsole = rerouteConsole(logger.child("console"));
	}
	return logger;
}

function build(
	sink: LogSink,
	clock: Clock,
	cell: LevelCell,
	scope: string,
	dispose: () => void,
): Logger {
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
		child: (childScope) => build(sink, clock, cell, `${scope}:${childScope}`, dispose),
		setLevel: (level) => {
			cell.level = level;
		},
		dispose,
	};
}

/** How many distinct error messages are tracked at once. */
export const MAX_TRACKED_MESSAGES = 1000;
/** A folded line is written after this much quiet. */
export const REPEAT_QUIET_MS = 5000;
/** A folded line is written at most this long after its first occurrence. */
export const REPEAT_MAX_WAIT_MS = 60_000;
/** A folded line is written at once after this many repeats. */
export const REPEAT_MAX_COUNT = 1000;

interface RepeatGroup {
	record: LogRecord;
	repeats: number;
	firstAt: number;
	cancelTimer: (() => void) | null;
}

export interface RepeatFolder {
	sink: LogSink;
	/** Writes every pending folded line now. */
	flush(): void;
	/** Flushes and stops folding; later records pass straight through. */
	dispose(): void;
}

/**
 * Wraps a sink so identical error lines are folded: the first is written at once and the repeats
 * are counted. A folded line is written after `quietMs` without a repeat, once `maxWaitMs` has
 * passed, or at the `maxRepeats`th repeat. At most `maxGroups` distinct messages are tracked; the
 * oldest group is written out to make room.
 */
export function createRepeatFolder(
	emit: LogSink,
	options: {
		clock: Clock;
		quietMs?: number;
		maxWaitMs?: number;
		maxRepeats?: number;
		maxGroups?: number;
		scheduler?: RepeatScheduler;
	},
): RepeatFolder {
	const quietMs = options.quietMs ?? REPEAT_QUIET_MS;
	const maxWaitMs = options.maxWaitMs ?? REPEAT_MAX_WAIT_MS;
	const maxRepeats = options.maxRepeats ?? REPEAT_MAX_COUNT;
	const maxGroups = options.maxGroups ?? MAX_TRACKED_MESSAGES;
	const scheduler = options.scheduler ?? defaultScheduler;
	const groups = new Map<string, RepeatGroup>();
	let disposed = false;

	const write = (record: LogRecord): void => {
		try {
			emit(record);
		} catch {
			// A failing sink must never break the code that logs.
		}
	};

	const flushGroup = (key: string): void => {
		const group = groups.get(key);
		if (group === undefined) return;
		groups.delete(key);
		group.cancelTimer?.();
		if (group.repeats === 0) return;
		write({
			at: options.clock.now(),
			level: group.record.level,
			scope: group.record.scope,
			message:
				group.repeats === 1
					? `${group.record.message} (repeated 1 time)`
					: `${group.record.message} (repeated ${group.repeats} times)`,
			data: { ...(group.record.data ?? {}), repeats: group.repeats },
		});
	};

	const schedule = (key: string, group: RepeatGroup): void => {
		group.cancelTimer?.();
		const elapsed = options.clock.now() - group.firstAt;
		const delay = Math.max(0, Math.min(quietMs, maxWaitMs - elapsed));
		group.cancelTimer = scheduler.after(delay, () => {
			group.cancelTimer = null;
			flushGroup(key);
		});
	};

	const sink: LogSink = (record) => {
		if (disposed || record.level !== "error") {
			write(record);
			return;
		}
		const key = `${record.scope}\u0000${record.message}`;
		const existing = groups.get(key);
		if (existing !== undefined) {
			existing.repeats += 1;
			if (existing.repeats >= maxRepeats) {
				flushGroup(key);
				return;
			}
			schedule(key, existing);
			return;
		}
		if (groups.size >= maxGroups) {
			const oldest = groups.keys().next();
			if (!oldest.done) flushGroup(oldest.value);
		}
		const group: RepeatGroup = {
			record,
			repeats: 0,
			firstAt: options.clock.now(),
			cancelTimer: null,
		};
		groups.set(key, group);
		schedule(key, group);
		write(record);
	};

	return {
		sink,
		flush() {
			for (const key of [...groups.keys()]) flushGroup(key);
		},
		dispose() {
			for (const key of [...groups.keys()]) flushGroup(key);
			disposed = true;
		},
	};
}

const defaultScheduler: RepeatScheduler = {
	after(ms, fn) {
		const timer = setTimeout(fn, ms);
		// A pending fold must not keep the sidecar process alive on its own.
		(timer as { unref?: () => void }).unref?.();
		return () => clearTimeout(timer);
	},
};

/** The console methods the reroute replaces. */
export interface ConsoleLike {
	log(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
	debug(...args: unknown[]): void;
}

/**
 * Sends console output to the logger instead of the terminal, so a module that still uses console
 * is captured in the app log. Returns the function that puts the original methods back.
 */
export function rerouteConsole(logger: Logger, target: ConsoleLike = console): () => void {
	const original = {
		log: target.log,
		info: target.info,
		warn: target.warn,
		error: target.error,
		debug: target.debug,
	};
	let routing = false;
	const route = (level: LogLevel, previous: (...args: unknown[]) => void) => {
		return (...args: unknown[]): void => {
			if (routing) {
				previous.apply(target, args);
				return;
			}
			routing = true;
			try {
				logger[level](formatConsoleArgs(args));
			} finally {
				routing = false;
			}
		};
	};
	target.log = route("info", original.log);
	target.info = route("info", original.info);
	target.warn = route("warn", original.warn);
	target.error = route("error", original.error);
	target.debug = route("debug", original.debug);
	return () => {
		target.log = original.log;
		target.info = original.info;
		target.warn = original.warn;
		target.error = original.error;
		target.debug = original.debug;
	};
}

function formatConsoleArgs(args: readonly unknown[]): string {
	return args.map(formatConsoleArg).join(" ");
}

function formatConsoleArg(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

/** Last words that mark a name as a secret on their own. */
const SECRET_WORDS = new Set([
	"token",
	"secret",
	"password",
	"passwd",
	"credential",
	"credentials",
	"authorization",
	"cookie",
	"apikey",
]);
/** Last words that mark a name as a secret only after another word. */
const QUALIFIED_SECRET_WORDS = new Set(["key", "pat"]);

/** True when a variable or data key name looks like it holds a secret (see the header). */
export function isSecretName(name: string): boolean {
	if (/^CONDUCTED_INTERNAL_/i.test(name)) return true;
	const words = name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[\s_.-]+/)
		.filter((word) => word !== "")
		.map((word) => word.toLowerCase());
	const last = words.at(-1);
	if (last === undefined) return false;
	if (SECRET_WORDS.has(last)) return true;
	return QUALIFIED_SECRET_WORDS.has(last) && words.length > 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/**
 * Replaces the values under secret-looking names, at any depth of plain objects and arrays, with a
 * marker that keeps only a string's length. Other values are kept as they are.
 */
export function redactSecrets(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
	if (Array.isArray(value)) {
		if (seen.has(value)) return "[circular]";
		seen.add(value);
		return value.map((entry) => redactSecrets(entry, seen));
	}
	if (!isPlainObject(value)) return value;
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	const out: Record<string, unknown> = {};
	for (const [name, entry] of Object.entries(value)) {
		if (isSecretName(name)) {
			out[name] = typeof entry === "string" ? `<redacted:${entry.length}>` : "<redacted>";
		} else {
			out[name] = redactSecrets(entry, seen);
		}
	}
	return out;
}

/** The record with its data redacted, for a sink whose lines leave the process. */
export function redactRecord(record: LogRecord): LogRecord {
	if (record.data === undefined) return record;
	return { ...record, data: redactSecrets(record.data) as Record<string, unknown> };
}
