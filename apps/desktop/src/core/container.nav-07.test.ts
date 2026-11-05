/**
 * @feature NAV-07 Command registry and default shortcuts
 * Owns: the composition root side of the command runner: the folder picker port and the live
 * command context read from the workspace, GitHub and sessions stores.
 * Behaviour: ui-map.md 5.1 and 5.4 (a command is enabled only when its context exists).
 * Test first: running project.add asks the platform's folder picker.
 */
import { describe, expect, it } from "vitest";
import { createMemoryPlatform, type MemoryPlatform } from "../platform/memory.ts";
import type { Database } from "../platform/platform.ts";
import { createContainer } from "./container.ts";
import { tomlCodec } from "./services/toml-codec.ts";

const unusedDatabase: Database = {
	execute: () => Promise.reject(new Error("NAV-07 does not use the database.")),
	select: () => Promise.reject(new Error("NAV-07 does not use the database.")),
	transaction: () => Promise.reject(new Error("NAV-07 does not use the database.")),
};

const clock = { now: () => 1_000 };
const ids = (() => {
	let next = 0;
	return { uuid: () => `id-${++next}` };
})();

function buildContainer(): {
	container: ReturnType<typeof createContainer>;
	memory: MemoryPlatform;
} {
	const memory = createMemoryPlatform({ clock, ids, database: unusedDatabase });
	const container = createContainer({
		platform: memory.platform,
		clock,
		ids,
		toml: tomlCodec,
		placeNames: { pick: () => "place" },
		sound: { play: async () => {} },
		windowFocused: () => true,
	});
	return { container, memory };
}

describe("NAV-07 container wiring", () => {
	it("registers project.add with the platform folder picker", async () => {
		const { container, memory } = buildContainer();
		memory.controls.queueDialogAnswers({ folder: "" });

		const result = await container.services.commands.run("project.add");

		expect(result).toMatchObject({ ok: false, error: { code: "repo_path_missing" } });
	});

	it("reads hasWorkspace from the workspace store", () => {
		const { container } = buildContainer();
		const commands = container.services.commands;
		expect(commands.isEnabled("workspace.archive")).toBe(false);

		container.services.workspace.store.setState({ workspacesById: { w: {} as never } });

		expect(commands.isEnabled("workspace.archive")).toBe(true);
	});

	it("reads hasOpenPr from the GitHub store", () => {
		const { container } = buildContainer();
		const commands = container.services.commands;
		expect(commands.isEnabled("pr.merge")).toBe(false);

		container.services.github.store.setState({
			byWorkspace: {
				w: { pullRequest: {} as never, unavailable: "none", fetchedAt: 1 },
			},
		});

		expect(commands.isEnabled("pr.merge")).toBe(true);
	});

	it("reads hasOpenChat from the sessions store", () => {
		const { container } = buildContainer();
		const commands = container.services.commands;
		expect(commands.isEnabled("chat.submit")).toBe(false);

		container.services.sessions.store.setState({ viewingSessionId: "s" as never });

		expect(commands.isEnabled("chat.submit")).toBe(true);
	});

	it("does not count a workspace with no pull request as an open pull request", () => {
		const { container } = buildContainer();
		container.services.github.store.setState({
			byWorkspace: {
				w: { pullRequest: null, unavailable: "no_pr", fetchedAt: 1 },
			},
		});

		expect(container.services.commands.isEnabled("pr.merge")).toBe(false);
	});
});
