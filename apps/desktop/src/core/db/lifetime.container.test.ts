// @vitest-environment node
/**
 * @feature DATA-02 Data-lifetime job reached from the composition root
 * Owns: the startup step that runs the job, and the named store that keeps an open interaction.
 * Behaviour: services-map.md 2.7.1 (live state is kept per chat so a restart can show it).
 * Test first: starting the real container removes a draft file older than the draft limit, and
 * a step that fails becomes a start warning.
 */
import { idleLiveState, type LiveState } from "@conducted/protocol";
import { type InteractionId, ok, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { draftFile } from "../app-paths.ts";
import type { StartReport } from "../container.ts";
import { sampleSession } from "./test-fixtures.ts";

const START = 1_800_000_000_000;
const DAY = 86_400_000;

let current: TestContainer | null = null;

afterEach(async () => {
	await current?.container.stop();
	current?.close();
	current = null;
	vi.restoreAllMocks();
});

const must = <T>(result: Result<T>): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** Starts the container with the services unrelated to the lifetime job quiet. */
async function startContainer(test: TestContainer): Promise<StartReport> {
	const { services } = test.container;
	for (const service of [
		services.repo,
		services.workspace,
		services.sections,
		services.favoriteModels,
		services.terminals,
		services.system,
	]) {
		vi.spyOn(service, "start").mockResolvedValue(ok(undefined) as never);
	}
	vi.spyOn(services.github, "checkAccess").mockResolvedValue(ok({ status: "unknown" }));
	vi.spyOn(services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
	const started = await test.container.start();
	expect(started.ok).toBe(true);
	if (!started.ok) throw new Error(started.error.message);
	return started.value;
}

describe("DATA-02 data lifetime from the composition root", () => {
	it("removes an old draft when the real container starts", async () => {
		let now = START;
		const clock = { now: () => now };
		const test = createTestContainer({ clock });
		current = test;
		const fs = test.memory.platform.fs;
		const file = draftFile(fs.paths, "old-chat");

		now = START - 31 * DAY;
		expect((await fs.writeTextAtomic(file, "{}")).ok).toBe(true);
		now = START;

		await startContainer(test);

		expect(await fs.exists(file)).toBe(false);
	});

	it("turns a failed lifetime step into a start warning and leaves the user's file alone", async () => {
		let now = START;
		const test = createTestContainer({ clock: { now: () => now } });
		current = test;
		const workspace = await seedWorkspace(test.container);
		const session = must(
			await test.container.services.sessions.create(workspace.id, sampleSession.config),
		);
		const fs = test.memory.platform.fs;
		const userFile = "/code/user-files/report.pdf";
		now = START - 8 * DAY;
		must(await fs.writeTextAtomic(userFile, "mine"));
		await test.database.execute(
			`INSERT INTO attachments (id, session_id, kind, original_name, path, is_draft, created_at)
			VALUES ($1, $2, 'text', 'report.pdf', $3, 1, $4)`,
			["attachment-user", session.id, userFile, START - 8 * DAY],
		);
		now = START;

		const report = await startContainer(test);

		const warning = report.warnings.find((entry) => entry.step === "data lifetime");
		expect(warning?.message).toContain("remove-draft-attachments");
		expect(warning?.message).toContain(userFile);
		expect(await fs.exists(userFile)).toBe(true);
	});

	it("keeps an open interaction in the live-state store and loads it on start", async () => {
		const test = createTestContainer();
		current = test;
		const workspace = await seedWorkspace(test.container);
		const session = must(
			await test.container.services.sessions.create(workspace.id, sampleSession.config),
		);
		const live: LiveState = {
			...idleLiveState,
			status: "working",
			openInteraction: {
				interactionId: "interaction-1" as InteractionId,
				since: START,
				interaction: {
					kind: "question",
					questions: [{ question: "Proceed?", options: [], multiSelect: false }],
				},
			},
		};
		must(await test.container.services.sessions.applyLiveState(session.id, live));

		test.container.services.sessions.store.setState({ liveStates: {}, openInteractions: {} });
		must(await test.container.services.sessions.start());

		const restored = test.container.services.sessions.store.getState().liveStates[session.id];
		expect(restored?.openInteraction?.interactionId).toBe("interaction-1");
		expect(restored?.openInteraction?.interaction.kind).toBe("question");
	});
});
