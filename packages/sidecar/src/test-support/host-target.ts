/**
 * Test support: the sidecar target this machine can compile and run.
 * Used by the tests that build a real compiled sidecar and start it. On Linux CI the answer is the
 * baseline Linux program, so the same test runs the exact build the sandbox image ships there.
 * Test only; it has no production caller.
 */
import { CLOUD_SIDECAR_TARGET, SIDECAR_TARGETS, type SidecarTarget } from "../packaging.ts";

/** The target for the machine the test is on, or a plain error when none exists. */
export function hostSidecarTarget(): SidecarTarget {
	if (process.platform === "darwin") {
		const target = SIDECAR_TARGETS.find((candidate) => candidate.arch === process.arch);
		if (target !== undefined) return target;
	}
	if (process.platform === "linux" && process.arch === "x64") return CLOUD_SIDECAR_TARGET;
	throw new Error(`No sidecar build for ${process.platform}-${process.arch}.`);
}
