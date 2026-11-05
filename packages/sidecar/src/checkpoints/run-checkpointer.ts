/**
 * @feature SIDE-08 Checkpoints: start before first write, end with file summary
 * Owns: running bin/checkpointer.sh as a detached process group and stopping it at its timeout.
 * Behaviour: research/conductor/sessions.md section 7: the script runs in the workspace folder
 * with a 60 s timeout, then SIGTERM to the process group and SIGKILL 5 s later. Its output and
 * error are each kept up to 64 KiB for the log line.
 * Must handle: a child that ignores SIGTERM (the group is killed after the grace), git children
 * that outlive the direct child (the whole group is signalled), a missing executable or folder
 * (the spawn throws and the caller turns it into a skipped checkpoint), and a script that prints
 * far more than the log line can hold (the streams are drained but only the first 64 KiB is kept).
 * Test first: a script that ignores SIGTERM is killed after the grace period.
 * Our design choice: the child gets its own process group through `detached`, so `-pid` reaches
 * every process it starts.
 */
import { MAX_LOG_LENGTH, type RunCheckpointer } from "./checkpoint-service.ts";

/**
 * Reads a stream to its end, keeping at most `maxBytes`. The rest is drained and dropped so the
 * child never blocks on a full pipe.
 */
async function readCapped(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
	const reader = stream.getReader();
	const kept: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value === undefined || length >= maxBytes) continue;
			const slice = value.subarray(0, Math.min(maxBytes - length, value.byteLength));
			kept.push(slice);
			length += slice.byteLength;
		}
	} finally {
		reader.releaseLock();
	}
	return new TextDecoder().decode(joinBytes(kept));
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	if (chunks.length === 1) return chunks[0] as Uint8Array;
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const joined = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}

/** Sends a signal to the child's process group, falling back to the child alone. */
function signalGroup(child: Bun.Subprocess, signal: "SIGTERM" | "SIGKILL"): void {
	const pid = child.pid;
	if (pid !== undefined) {
		try {
			process.kill(-pid, signal);
			return;
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code === "ESRCH") return;
		}
	}
	try {
		child.kill(signal);
	} catch {
		// The process is already gone.
	}
}

/** Runs checkpointer.sh for one request. */
export const runCheckpointer: RunCheckpointer = async (args, options) => {
	const child = Bun.spawn({
		cmd: [...args],
		cwd: options.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		detached: true,
	});
	const terminate = setTimeout(() => {
		signalGroup(child, "SIGTERM");
	}, options.timeoutMs);
	const kill = setTimeout(() => {
		signalGroup(child, "SIGKILL");
	}, options.timeoutMs + options.killGraceMs);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			readCapped(child.stdout, MAX_LOG_LENGTH),
			readCapped(child.stderr, MAX_LOG_LENGTH),
			child.exited,
		]);
		return { exitCode: exitCode ?? -1, stdout, stderr };
	} finally {
		clearTimeout(terminate);
		clearTimeout(kill);
	}
};
