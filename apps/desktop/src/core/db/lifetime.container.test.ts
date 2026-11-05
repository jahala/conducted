// @vitest-environment node
/**
 * @feature DATA-02 Data-lifetime job reached from the composition root
 * Owns: the startup step that runs the job, and the named store that keeps an open interaction.
 * Behaviour: services-map.md 2.7.1 (live state is kept per chat so a restart can show it).
 * Test first: starting the real container removes a draft file older than the draft limit.
 */
import { idleLiveState, type LiveState } from "@conducted/protocol";
import { type InteractionId, ok, type Result } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { draftFile } from "../app-paths.ts";
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
async function startContainer(test: TestContainer): Promise<void> {
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
	expect((await test.container.start()).ok).toBe(true);
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
