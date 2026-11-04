/**
 * @feature SIDE-18 Logger mode
 * Owns: the "logger" mode of the sidecar program: a small HTTP server on 127.0.0.1 that collects
 * log records from the UI, the Rust shell and the sidecar, keeps them in a ring buffer, and serves
 * them back for the diagnostics page and for log export.
 * Behaviour: research/conductor/native-and-sidecar-map.md A7 and B5 "logger": HTTP on a random
 * port, bearer token from an environment variable, routes health, config, logs (post and get with
 * filters), save, export as NDJSON and stream as server-sent events; it writes a discovery file
 * with the url, pid and time; the launcher reads LOGGER_PORT=<n> from stdout. The external
 * Honeycomb export is not built (a cloud feature).
 * Routes (ours):
 *  - GET /health: { ok: true, records, dropped }
 *  - POST /logs: one record or an array; each validated; answer { accepted }
 *  - GET /logs?level=&scope=&search=&since=: JSON array
 *  - GET /export: NDJSON, first line a header with the dropped count
 *  - GET /stream: server-sent events of new records
 * Must handle:
 *  - every route except /health needs the bearer token; compare in constant time; 401 otherwise
 *  - requests must come from 127.0.0.1 with a Host header of 127.0.0.1:<port>; other Hosts get 403
 *    (a web page in a browser must not be able to read logs by DNS rebinding)
 *  - an Origin header other than the app's own origin is refused (Conductor allows tauri://localhost)
 *  - body size limit of 1 MiB; a record that fails the schema is counted and skipped
 *  - disk persistence is optional; the file mode is 0600 and the folder 0700; the total is capped
 *    at 100 MiB by removing the oldest file through the Trash
 *  - the discovery file is rewritten at start and moved to the Trash at exit
 *  - a client that disconnects from /stream is dropped without error
 * Test first: a POST /logs without the bearer token answers 401 and stores nothing.
 */
import type { AppError, Result } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { LogRing } from "./log-ring.ts";
import type { Logger } from "./logger.ts";

export interface LoggerServerDeps {
	ring: LogRing;
	/** The bearer token from the environment. Never logged. */
	token: string;
	/** Where to keep log files, or null for memory only. */
	persistDir: string | null;
	/** Absolute path of the discovery file. */
	discoveryFile: string;
	logger: Logger;
}

export interface LoggerServer {
	/** Starts listening on 127.0.0.1 with a random port. Returns the port. */
	start(): Promise<Result<{ port: number }, AppError>>;
	stop(): Promise<void>;
}

export class HttpLoggerServer implements LoggerServer {
	constructor(protected readonly deps: LoggerServerDeps) {}

	start(): Promise<Result<{ port: number }, AppError>> {
		return notImplemented("SIDE-18");
	}

	stop(): Promise<void> {
		return notImplemented("SIDE-18");
	}
}
