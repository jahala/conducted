// @vitest-environment jsdom
/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * @feature NAV-10 Center tab strip: chat, terminal, file, PR and browser tabs, split panes
 * Owns: tests over the real container and both strips that a terminal shows where it was made: the
 * bottom panel's "+" adds a panel tab and no centre tab, and the centre's "+" menu adds a centre
 * tab and no panel tab. The panel draws its own view; the centre draws through the surface layer.
 * Behaviour: ui-map.md 3.2 ("+" menu "Local terminal"), 3.7 ("New terminal").
 * Test first: a terminal made from the bottom panel's "+" adds a tab there and none in the centre.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { WithSurfaces } from "../../test/surfaces.tsx";
import { ScriptsPanel } from "../scripts-panel/ScriptsPanel.tsx";
import { TabContent } from "./TabContent.tsx";
import { TabStrip } from "./TabStrip.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const containers: TestContainer[] = [];

afterEach(() => {
	cleanup();
	for (const test of containers.splice(0)) test.close();
});

/** The centre strip and the bottom panel over one real container, sharing the URL the centre sets. */
function Harness({ workspaceId, sessionId }: { workspaceId: WorkspaceId; sessionId: SessionId }) {
	const [search, setSearch] = useState<WorkspaceSearch>({ tab: "session", sessionId });
	return (
		<CommandDispatcher>
			<div data-testid="centre">
				<TabStrip
					workspaceId={workspaceId}
					search={search}
					onSearchChange={(patch) => setSearch((current) => ({ ...current, ...patch }))}
				/>
				<TabContent
					workspaceId={workspaceId}
					search={search}
					onSearchChange={(patch) => setSearch((current) => ({ ...current, ...patch }))}
				/>
			</div>
			<div data-testid="panel">
				<ScriptsPanel workspaceId={workspaceId} />
			</div>
		</CommandDispatcher>
	);
}

async function mount(): Promise<{
	test: TestContainer;
	centre: HTMLElement;
	panel: HTMLElement;
}> {
	const test = createTestContainer();
	containers.push(test);
	const workspace = await seedWorkspace(test.container);
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	// The app loads settings before any screen shows; a new terminal waits for them.
	must(await test.container.services.settings.start());
	must(await test.container.services.workspace.start());
	const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	must(await test.container.services.sessions.start());

	render(
		<ServicesProvider container={test.container}>
			<WithSurfaces>
				<Harness workspaceId={workspace.id as WorkspaceId} sessionId={chat.id} />
			</WithSurfaces>
		</ServicesProvider>,
	);

	return {
		test,
		centre: await screen.findByTestId("centre"),
		panel: await screen.findByTestId("panel"),
	};
}

describe("RUN-01 a terminal opens where its " + " was", () => {
	it("adds a terminal made from the bottom panel's + to the panel and not the centre", async () => {
		const { centre, panel } = await mount();

		fireEvent.click(within(panel).getByRole("button", { name: "New terminal" }));

		const tab = await within(panel).findByRole("tab", { name: "Terminal 1" });
		expect(tab.getAttribute("aria-selected")).toBe("true");
		expect(within(centre).queryByRole("tab", { name: "Terminal 1" })).toBeNull();
		expect(panel.querySelector("[data-terminal-view]")).not.toBeNull();
		expect(document.querySelector("[data-surface-layer] [data-terminal-view]")).toBeNull();
	});

	it("adds a terminal made from the centre's + menu to the centre and not the panel", async () => {
		const { centre, panel } = await mount();

		const trigger = within(centre).getByRole("button", { name: "New tab" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		await screen.findByRole("menu");
		fireEvent.click(await screen.findByRole("menuitem", { name: "Local terminal" }));

		expect(await within(centre).findByRole("tab", { name: "Terminal 1" })).toBeTruthy();
		expect(within(panel).queryByRole("tab", { name: "Terminal 1" })).toBeNull();
		await waitFor(() =>
			expect(document.querySelector("[data-surface-layer] [data-terminal-view]")).not.toBeNull(),
		);
		expect(panel.querySelector("[data-terminal-view]")).toBeNull();
	});
});
