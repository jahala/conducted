/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: the real files and clock behind the memory-exhaustion probe: `/proc/vmstat`, the watchdog's
 * incident marker and a timer for the one settle wait.
 * Behaviour: session/memory-exhaustion.ts (the detection a failed turn uses).
 * Must handle: a missing file (null, not an error); any other read failure is handed on.
 * Test first: the OOM kill counter is read through the same probe, in
 * session/memory-exhaustion.test.ts.
 */
import { readFile } from "node:fs/promises";
import type { MemoryProbePorts } from "../session/memory-exhaustion.ts";

/** The probe's ports over the real file system, clock and timer. */
export function createNodeMemoryProbePorts(): MemoryProbePorts {
	return {
		async readText(path) {
			try {
				return await readFile(path, "utf8");
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
				throw cause;
			}
		},
		now: () => Date.now(),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	};
}
