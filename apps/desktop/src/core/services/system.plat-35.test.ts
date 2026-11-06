/**
 * @feature PLAT-35 Install and update gh and watchexec (D024)
 * Owns: tests for where the managed gh and watchexec reach the app: the PATH prefix of terminals
 * and scripts, and the agent programs list that stays Claude and Codex only.
 * Test first: with no chosen program path, terminals and scripts get the app's bin folder in the
 * data folder, where the program manager links gh and watchexec.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../../test/container.ts";

describe("PLAT-35 managed helper programs in the system service", () => {
	it("puts the app's bin folder in the data folder first on PATH, where the managed programs are linked", async () => {
		const test = createTestContainer();
		try {
			const paths = test.container.platform.fs.paths;

			const prefix = await test.container.services.system.pathPrefix();

			expect(prefix).toEqual({ ok: true, value: `${paths.appData}/bin` });
		} finally {
			test.close();
		}
	});

	it("keeps gh and watchexec out of the agent programs the Advanced page lists", async () => {
		const test = createTestContainer();
		try {
			expect((await test.container.services.system.start()).ok).toBe(true);
			for (const program of ["gh", "watchexec", "codex"] as const) {
				expect((await test.container.platform.programs.install(program)).ok).toBe(true);
			}

			const programs = test.container.services.system.store.getState().programs;
			expect(programs.state).toBe("ready");
			if (programs.state !== "ready") return;
			expect(programs.data.map((view) => view.status.program)).toEqual(["codex"]);
		} finally {
			test.close();
		}
	});
});
