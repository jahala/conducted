/**
 * @feature SIDE-18 Logger mode: the in-memory log store
 * Owns: a ring buffer of log records limited by size in bytes, with filtering for the logger
 * mode's query route.
 * Behaviour: research/conductor/native-and-sidecar-map.md A7 and B5 "logger": an in-memory ring
 * buffer of UI, Rust and sidecar logs with a byte limit, filters by tags, origins, levels and a
 * search text, optional disk persistence, export as NDJSON.
 * Must handle: the oldest records are dropped first when the byte limit is exceeded, one record
 * larger than the whole limit is dropped (and counted), filters combine with AND, an empty filter
 * returns everything, the search is case-insensitive over message and scope, and the count of
 * dropped records is available so the export can say that the start is missing.
 * Test first: with a limit of 100 bytes and records of 40 bytes, the third add drops the first.
 * Data lifetime: memory only; the limit is 64 MiB by default (our choice; Conductor allows 2 GiB).
 * Disk files are written by the logger server with a separate 100 MiB cap (same as Conductor) and
 * rotated by removing the oldest file through the Trash.
 */
import type { LogLevel, LogRecord } from "./logger.ts";

export const DEFAULT_RING_BYTES = 64 * 1024 * 1024;

export interface LogFilter {
	levels?: readonly LogLevel[];
	scopes?: readonly string[];
	search?: string;
	sinceMs?: number;
}

function sizeOf(record: LogRecord): number {
	return JSON.stringify(record).length;
}

export class LogRing {
	private readonly records: { record: LogRecord; bytes: number }[] = [];
	private totalBytes = 0;
	private droppedCount = 0;

	constructor(private readonly maxBytes: number = DEFAULT_RING_BYTES) {}

	add(record: LogRecord): void {
		const bytes = sizeOf(record);
		if (bytes > this.maxBytes) {
			this.droppedCount += 1;
			return;
		}
		this.records.push({ record, bytes });
		this.totalBytes += bytes;
		while (this.totalBytes > this.maxBytes) {
			const oldest = this.records.shift();
			if (!oldest) break;
			this.totalBytes -= oldest.bytes;
			this.droppedCount += 1;
		}
	}

	query(filter: LogFilter = {}): LogRecord[] {
		const needle = filter.search?.toLowerCase();
		return this.records
			.map((entry) => entry.record)
			.filter((record) => {
				if (filter.levels && !filter.levels.includes(record.level)) return false;
				if (filter.scopes && !filter.scopes.some((scope) => record.scope.startsWith(scope)))
					return false;
				if (filter.sinceMs !== undefined && record.at < filter.sinceMs) return false;
				if (needle !== undefined) {
					const haystack = `${record.scope} ${record.message}`.toLowerCase();
					if (!haystack.includes(needle)) return false;
				}
				return true;
			});
	}

	get bytes(): number {
		return this.totalBytes;
	}

	get dropped(): number {
		return this.droppedCount;
	}
}
