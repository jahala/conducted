// @vitest-environment node
/**
 * @feature SIDE-21 Agent settings reach the sidecar: program paths, environment, keys
 * Behaviour: other-runners.md 5 (the agent detector gets the Settings program paths).
 * Test first: the real container sends the chosen program paths once the sidecar is up, and again
 * when one changes.
 */
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

// The lifetime job's startup step is unrelated to the program paths, so it reports a skipped run.
vi.mock("../db/lifetime.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../db/lifetime.ts")>();
	return {
		...actual,
		runDataLifetimeJob: async () => ({
			ok: true,
			value: { kind: "skipped", lastRunAt: 0 },
		}),
	};
});

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let open: TestContainer | null = null;

afterEach(async () => {
	if (open !== null) {
		await open.container.stop();
		open.close();
		open = null;
	}
	vi.restoreAllMocks();
});

/** The `setAgentPrograms` notifications the container sent, oldest first. */
const programsSent = (test: TestContainer): unknown[] =>
	test.memory.controls.sidecarSent
		.map((line) => JSON.parse(line) as { method?: string; params?: { programs?: unknown } })
		.filter((message) => message.method === "setAgentPrograms")
		.map((message) => message.params?.programs);

/** Starts the real container, with the services unrelated to the sidecar kept quiet. */
const startContainer = async (): Promise<TestContainer> => {
	const test = createTestContainer();
	open = test;
	const quiet = [
		test.container.services.repo,
		test.container.services.workspace,
		test.container.services.sections,
		test.container.services.favoriteModels,
		test.container.services.terminals,
		test.container.services.sessions,
		test.container.services.system,
	];
	for (const service of quiet) {
		vi.spyOn(service, "start").mockImplementation(async () => ok(undefined) as never);
	}
	vi.spyOn(test.container.services.github, "checkAccess").mockResolvedValue(
		ok({ status: "unknown" }),
	);
	vi.spyOn(test.container.services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
	must(await test.container.start());
	return test;
};

describe("SIDE-21 the sidecar learns the chosen agent programs", () => {
	it("sends the chosen program paths once the sidecar is up, and again when one changes", async () => {
		const test = await startContainer();
		expect(programsSent(test)).toEqual([[]]);

		must(await test.container.services.settings.set("claude_executable_path", "/opt/claude"));
		await vi.waitFor(() => expect(programsSent(test)).toHaveLength(2));
		expect(programsSent(test)[1]).toEqual([{ agent: "claude", path: "/opt/claude" }]);

		// A setting that is not a program path sends nothing new.
		must(await test.container.services.settings.set("chrome_mode_enabled", true));
		must(
			await test.container.services.settings.set(
				"opencode_executable_path",
				"/opt/opencode/bin/opencode",
			),
		);
		await vi.waitFor(() => expect(programsSent(test)).toHaveLength(3));
		expect(programsSent(test)[2]).toEqual([
			{ agent: "claude", path: "/opt/claude" },
			{ agent: "acp", acpAgent: "opencode", path: "/opt/opencode/bin/opencode" },
		]);
	});
});
