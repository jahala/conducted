/**
 * @feature PLAT-28 Agent program manager
 * Owns: tests for the program status store and the install, re-download and remove actions.
 * Test first: install while a download of the same program runs starts no second download.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProgramStatus } from "../../platform/platform.ts";
import { createTestContainer } from "../../test/container.ts";
import { SystemService } from "./system.ts";

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("PLAT-28 SystemService programs", () => {
	it("installs a program once when two installs of it overlap", async () => {
		const test = createTestContainer();
		try {
			const gate = deferred<Result<void>>();
			let calls = 0;
			vi.spyOn(test.container.platform.programs, "install").mockImplementation(() => {
				calls += 1;
				return gate.promise;
			});

			const first = test.container.services.system.installProgram("claude");
			const second = test.container.services.system.installProgram("claude");
			expect(calls).toBe(1);

			gate.resolve(ok(undefined));
			expect((await first).ok).toBe(true);
			expect((await second).ok).toBe(true);
		} finally {
			test.close();
		}
	});

	it("reaches the platform through the container's program actions", async () => {
		const test = createTestContainer();
		try {
			const install = vi.spyOn(test.container.platform.programs, "install");

			const result = await test.container.actions.programs.install("claude");

			expect(result.ok).toBe(true);
			expect(install).toHaveBeenCalledWith("claude");
		} finally {
			test.close();
		}
	});

	it("starts a new install after the first one has finished", async () => {
		const test = createTestContainer();
		try {
			const install = vi.spyOn(test.container.platform.programs, "install");

			expect((await test.container.services.system.installProgram("codex")).ok).toBe(true);
			expect((await test.container.services.system.installProgram("codex")).ok).toBe(true);

			expect(install).toHaveBeenCalledTimes(2);
		} finally {
			test.close();
		}
	});

	it("loads the program statuses and follows their changes", async () => {
		const test = createTestContainer();
		try {
			expect((await test.container.services.system.start()).ok).toBe(true);
			expect((await test.container.platform.programs.install("claude")).ok).toBe(true);

			const programs = test.container.services.system.store.getState().programs;
			expect(programs.state).toBe("ready");
			if (programs.state !== "ready") return;
			const claude = programs.data.find((view) => view.status.program === "claude");
			expect(claude?.status.state).toBe("ready");
			expect(claude?.status.path).not.toBeNull();
		} finally {
			test.close();
		}
	});

	it("does not let a status list that finishes late overwrite a newer status", async () => {
		const test = createTestContainer();
		try {
			const gate = deferred<Result<ProgramStatus[]>>();
			vi.spyOn(test.container.platform.programs, "statuses").mockImplementation(() => gate.promise);

			const started = test.container.services.system.start();
			expect((await test.container.platform.programs.install("claude")).ok).toBe(true);
			gate.resolve(ok([]));
			expect((await started).ok).toBe(true);

			const programs = test.container.services.system.store.getState().programs;
			expect(programs.state).toBe("ready");
			if (programs.state !== "ready") return;
			expect(programs.data.map((view) => view.status.program)).toEqual(["claude"]);
			expect(programs.data[0]?.status.state).toBe("ready");
		} finally {
			test.close();
		}
	});

	it("reports a status list that cannot be read", async () => {
		const test = createTestContainer();
		try {
			const failure: Result<ProgramStatus[]> = err(
				appError("programs_state_failed", "The list could not be read."),
			);
			vi.spyOn(test.container.platform.programs, "statuses").mockResolvedValue(failure);

			const result = await test.container.services.system.start();

			expect(result.ok).toBe(false);
			expect(test.container.services.system.store.getState().programs.state).toBe("error");
		} finally {
			test.close();
		}
	});

	it("re-downloads and removes a program through the platform", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.system.start();
			expect((await test.container.services.system.redownloadProgram("claude")).ok).toBe(true);
			expect((await test.container.services.system.removeProgram("claude")).ok).toBe(true);

			const programs = test.container.services.system.store.getState().programs;
			expect(programs.state).toBe("ready");
			if (programs.state !== "ready") return;
			expect(programs.data.find((view) => view.status.program === "claude")?.status.state).toBe(
				"missing",
			);
		} finally {
			test.close();
		}
	});

	it("shows the path the user chose instead of the managed copy", async () => {
		const test = createTestContainer();
		try {
			const service = new SystemService({
				platform: test.container.platform,
				setting: <T>(key: string) => (key === "claude_executable_path" ? "/opt/claude" : "") as T,
				now: () => 0,
			});
			await service.start();
			await test.container.platform.programs.install("claude");

			const programs = service.store.getState().programs;
			expect(programs.state).toBe("ready");
			if (programs.state !== "ready") return;
			expect(programs.data.find((view) => view.status.program === "claude")?.userPath).toBe(
				"/opt/claude",
			);
			service.dispose();
		} finally {
			test.close();
		}
	});

	it("stops following status events after dispose", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.system;
			await service.start();
			service.dispose();
			await test.container.platform.programs.install("claude");

			const programs = service.store.getState().programs;
			expect(programs.state).toBe("ready");
			if (programs.state !== "ready") return;
			expect(programs.data).toEqual([]);
		} finally {
			test.close();
		}
	});
});

describe("D088 the program path the app runs", () => {
	it("returns the program manager's copy for a ready program", async () => {
		const test = createTestContainer();
		try {
			const path = `${test.memory.platform.fs.paths.appData}/bin/gh`;

			expect(await test.container.services.system.programPath("gh")).toEqual(ok(path));
		} finally {
			test.close();
		}
	});

	it("returns the user's chosen path for an agent, even after a failed download", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.setProgramStatus({
				program: "claude",
				state: "failed",
				version: null,
				bytesDownloaded: 0,
				bytesTotal: null,
				attempt: 1,
				nextAttemptAt: null,
				error: "The download was cut off.",
				path: null,
				follow: null,
			});
			const service = new SystemService({
				platform: test.container.platform,
				setting: <T>(key: string) => (key === "claude_executable_path" ? "/opt/claude" : "") as T,
				now: () => 0,
			});

			expect(await service.programPath("claude")).toEqual(ok("/opt/claude"));
			service.dispose();
		} finally {
			test.close();
		}
	});

	it("names a failed program, shows its error and points to Retry instead of a PATH copy", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.setProgramStatus({
				program: "gh",
				state: "failed",
				version: null,
				bytesDownloaded: 0,
				bytesTotal: null,
				attempt: 5,
				nextAttemptAt: null,
				error: "The download was cut off.",
				path: null,
				follow: null,
			});

			const result = await test.container.services.system.programPath("gh");

			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.error.code).toBe("program_not_installed");
			expect(result.error.message).toContain("GitHub CLI (gh)");
			expect(result.error.message).toContain("The download was cut off.");
			expect(result.error.message).toContain("Retry");
		} finally {
			test.close();
		}
	});

	it("treats a missing bin link as not installed, so the shell never finds another copy", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.files.delete(`${test.memory.platform.fs.paths.appData}/bin/gh`);

			const result = await test.container.services.system.programPath("gh");

			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.error.code).toBe("program_not_installed");
				expect(result.error.message).toContain("Retry");
			}
		} finally {
			test.close();
		}
	});

	it("keeps gh and watchexec in the helper list, apart from the agent programs", async () => {
		const test = createTestContainer();
		try {
			expect((await test.container.services.system.start()).ok).toBe(true);

			const state = test.container.services.system.store.getState();
			expect(state.programs.state).toBe("ready");
			expect(state.helpers.state).toBe("ready");
			if (state.helpers.state !== "ready" || state.programs.state !== "ready") return;
			expect(state.helpers.data.map((view) => view.status.program)).toEqual(["gh", "watchexec"]);
			expect(state.programs.data).toEqual([]);
		} finally {
			test.close();
		}
	});
});

describe("PLAT-28 send gate", () => {
	const status = (
		program: ProgramStatus["program"],
		state: ProgramStatus["state"],
	): ProgramStatus => ({
		program,
		state,
		version: "1.0.0",
		bytesDownloaded: 0,
		bytesTotal: null,
		attempt: 0,
		nextAttemptAt: null,
		error: null,
		path: null,
		follow: null,
	});

	const serviceWith = async (
		statuses: ProgramStatus[],
		settings: Readonly<Record<string, string>> = {},
	) => {
		const test = createTestContainer();
		vi.spyOn(test.container.platform.programs, "statuses").mockResolvedValue(ok(statuses));
		const service = new SystemService({
			platform: test.container.platform,
			setting: <T>(key: string) => (settings[key] ?? "") as T,
			now: () => 0,
		});
		expect((await service.start()).ok).toBe(true);
		return { test, service };
	};

	it("holds a send while the agent's managed copy is being made ready", async () => {
		for (const state of ["queued", "downloading", "verifying", "retrying"] as const) {
			const { test, service } = await serviceWith([status("claude", state)]);
			try {
				expect(service.holdsSend("claude"), state).toBe(true);
				expect(service.holdsSend("codex"), state).toBe(false);
			} finally {
				service.dispose();
				test.close();
			}
		}
	});

	it("does not hold a send once the copy is ready, failed or missing, or for an agent it does not manage", async () => {
		for (const state of ["ready", "failed", "missing"] as const) {
			const { test, service } = await serviceWith([status("codex", state)]);
			try {
				expect(service.holdsSend("codex"), state).toBe(false);
			} finally {
				service.dispose();
				test.close();
			}
		}
		const { test, service } = await serviceWith([status("claude", "downloading")]);
		try {
			expect(service.holdsSend("acp")).toBe(false);
			expect(service.holdsSend("cursor")).toBe(false);
		} finally {
			service.dispose();
			test.close();
		}
	});

	it("does not hold a send when the user chose a program path of their own", async () => {
		const { test, service } = await serviceWith([status("claude", "downloading")], {
			claude_executable_path: "/opt/claude",
		});
		try {
			expect(service.holdsSend("claude")).toBe(false);
		} finally {
			service.dispose();
			test.close();
		}
	});
});
