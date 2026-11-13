import type { SessionConfig } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { NO_TERMINAL_OUTPUT } from "./terminals.ts";

const config: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const opened: TestContainer[] = [];

const setup = async () => {
	const test = createTestContainer();
	opened.push(test);
	const workspace = await seedWorkspace(test.container);
	const created = await test.container.services.sessions.create(workspace.id, config);
	if (!created.ok) throw new Error("could not create a chat");
	return { test, workspace, sessionId: created.value.id };
};

afterEach(async () => {
	for (const test of opened.splice(0)) {
		test.close();
	}
});

describe("COMP-04 terminal output attachment", () => {
	it("attaches the terminal's screen text as a draft file", async () => {
		const { test, workspace, sessionId } = await setup();
		// seam: COMP-04 reads the screen through RUN-07's outputFor; PLAT-08 saves no screen yet.
		const outputFor = vi
			.spyOn(test.container.services.terminals, "outputFor")
			.mockResolvedValue(ok({ output: "build finished\n", source: "Terminal", running: false }));

		const added = await test.container.services.composer.addTerminalOutput(sessionId);
		expect(outputFor).toHaveBeenCalledWith(workspace.id, "auto", 1_000);
		expect(added.ok).toBe(true);
		if (!added.ok) return;
		expect(added.value.endsWith("terminal-output.txt")).toBe(true);
		expect(test.memory.controls.files.get(added.value)).toBe("build finished\n");
		expect(test.container.services.composer.draftOf(sessionId).attachmentPaths).toEqual([
			added.value,
		]);
	});

	it("says no output is available when the workspace has no terminal", async () => {
		const { test, sessionId } = await setup();
		// seam: COMP-04 reads the screen through RUN-07's outputFor; PLAT-08 saves no screen yet.
		vi.spyOn(test.container.services.terminals, "outputFor").mockResolvedValue(
			ok({ output: NO_TERMINAL_OUTPUT, source: "Terminal", running: false }),
		);

		const added = await test.container.services.composer.addTerminalOutput(sessionId);
		expect(added.ok).toBe(false);
		if (added.ok) return;
		expect(added.error.message).toBe("No terminal output available for this workspace");
	});

	it("says the attachment failed when the file cannot be written", async () => {
		const { test, sessionId } = await setup();
		// seam: COMP-04 reads the screen through RUN-07's outputFor; PLAT-08 saves no screen yet.
		vi.spyOn(test.container.services.terminals, "outputFor").mockResolvedValue(
			ok({ output: "build finished\n", source: "Terminal", running: false }),
		);
		vi.spyOn(test.container.platform.fs, "writeTextAtomic").mockResolvedValue(
			err(appError("fs_denied", "The file could not be written.")),
		);

		const added = await test.container.services.composer.addTerminalOutput(sessionId);
		expect(added.ok).toBe(false);
		if (added.ok) return;
		expect(added.error.message).toBe("Failed to attach terminal output");
	});

	it("never attaches an empty screen", async () => {
		const { test, sessionId } = await setup();
		// seam: COMP-04 reads the screen through RUN-07's outputFor; PLAT-08 saves no screen yet.
		vi.spyOn(test.container.services.terminals, "outputFor").mockResolvedValue(
			ok({ output: "  \n", source: "Terminal", running: false }),
		);

		const added = await test.container.services.composer.addTerminalOutput(sessionId);
		expect(added.ok).toBe(false);
		if (added.ok) return;
		expect(added.error.message).toBe("No terminal output available for this workspace");
	});
});

describe("COMP-04 a file attached from the workspace with no chat open", () => {
	it("says No active chat selected., as Conductor does (renderApp @2520921)", async () => {
		const test = createTestContainer();
		opened.push(test);
		const workspace = await seedWorkspace(test.container);
		const attached = await test.container.actions.files.attachToChat(workspace.id, [
			`${workspace.path}/README.md`,
		]);
		expect(attached.ok).toBe(false);
		if (attached.ok) return;
		expect(attached.error.message).toBe("No active chat selected.");
	});
});
