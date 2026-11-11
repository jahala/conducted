// @vitest-environment jsdom
/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * @feature NAV-10 Center tab strip: chat, terminal, file, PR and browser tabs, split panes
 * Owns: tests over the real container, the real centre (SplitPanes and its strip) and the real
 * bottom panel that a terminal tab dragged with pointer events moves between the two strips, as
 * Conductor allows with Split tabs on: the same terminal, its tab opening where it lands, the strip
 * it left picking its next tab, the panel's limit, and no drag with Split tabs off.
 * Behaviour: issue #527; renderApp @4993207 (the right panel's terminal tab drags only with the
 * configurable centre on, as "right-terminal" labelled "Terminal"), @10209498 (the centre moves it,
 * places its tab at the drop and opens it), @4395873 and @4999333 (the panel takes a centre terminal
 * tab anywhere on it, refuses one at its terminal limit, and makes the moved terminal active).
 * Test first: a panel terminal's tab dragged onto the centre strip moves it there.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId, TerminalId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { dragPointer, layOut, middleOf, type TestBox } from "../../test/pointer-drag.ts";
import { WithSurfaces } from "../../test/surfaces.tsx";
import { toast } from "../../ui/Toast.tsx";
import { ScriptsPanel } from "../scripts-panel/ScriptsPanel.tsx";
import { SplitPanes } from "./SplitPanes.tsx";
import { TabDragProvider } from "./tab-drag.tsx";
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

/** Where the test lays out the centre strip, its first tab and the bottom panel. */
const STRIP: TestBox = { left: 0, top: 0, width: 800, height: 40 };
const FIRST_TAB: TestBox = { left: 16, top: 4, width: 176, height: 32 };
const SECOND_TAB: TestBox = { left: 200, top: 4, width: 176, height: 32 };
const PANEL: TestBox = { left: 900, top: 500, width: 400, height: 300 };
/** A point on the centre strip past its tabs: the end of the strip. */
const STRIP_END = { x: 700, y: 20 };

const containers: TestContainer[] = [];

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	for (const test of containers.splice(0)) test.close();
});

/** The centre and the bottom panel over one real container, as the workspace screen joins them. */
function Harness({
	workspaceId,
	initial,
	onSearch,
}: {
	workspaceId: WorkspaceId;
	initial: WorkspaceSearch;
	onSearch: (search: WorkspaceSearch) => void;
}) {
	const [search, setSearch] = useState<WorkspaceSearch>(initial);
	const change = (patch: Partial<WorkspaceSearch>) =>
		setSearch((current) => {
			const next = { ...current, ...patch };
			onSearch(next);
			return next;
		});
	return (
		<CommandDispatcher>
			<TabDragProvider>
				<div data-testid="centre">
					<SplitPanes workspaceId={workspaceId} search={search} onSearchChange={change} />
				</div>
				<div data-testid="panel">
					<ScriptsPanel workspaceId={workspaceId} />
				</div>
			</TabDragProvider>
		</CommandDispatcher>
	);
}

interface Mounted {
	test: TestContainer;
	workspaceId: WorkspaceId;
	chatId: SessionId;
	centre: HTMLElement;
	panel: HTMLElement;
	searches: WorkspaceSearch[];
}

async function setUp(splitTabs = true) {
	const test = createTestContainer();
	containers.push(test);
	const workspace = await seedWorkspace(test.container);
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	// The app loads settings before any screen shows; a new terminal waits for them.
	must(await test.container.services.settings.start());
	must(
		await test.container.services.settings.set("experimental_configurable_center_panel", splitTabs),
	);
	must(await test.container.services.workspace.start());
	const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	must(await test.container.services.sessions.start());
	return { test, workspaceId: workspace.id as WorkspaceId, chatId: chat.id };
}

async function mount(
	ready: { test: TestContainer; workspaceId: WorkspaceId; chatId: SessionId },
	initial?: WorkspaceSearch,
): Promise<Mounted> {
	const searches: WorkspaceSearch[] = [];
	render(
		<ServicesProvider container={ready.test.container}>
			<WithSurfaces>
				<Harness
					workspaceId={ready.workspaceId}
					initial={initial ?? { tab: "session", sessionId: ready.chatId }}
					onSearch={(search) => searches.push(search)}
				/>
			</WithSurfaces>
		</ServicesProvider>,
	);
	const centre = await screen.findByTestId("centre");
	const panel = await screen.findByTestId("panel");
	return { ...ready, centre, panel, searches };
}

/** Gives the centre strip, its tabs in the order shown, and the panel the boxes the drags hit. */
function layOutStrips({ centre, panel }: Mounted): void {
	const strip = centre.querySelector('[data-tab-strip="group-main"]');
	if (strip === null) throw new Error("The centre strip is not drawn.");
	layOut(strip, STRIP);
	const tabs = [...strip.querySelectorAll("[data-tab-ref]")];
	for (const [index, tab] of tabs.entries()) {
		layOut(tab, index === 0 ? FIRST_TAB : { ...SECOND_TAB, left: 200 + (index - 1) * 184 });
	}
	const root = panel.firstElementChild;
	if (root === null) throw new Error("The panel is not drawn.");
	layOut(root, PANEL);
}

const centreStrip = (centre: HTMLElement) =>
	within(centre).getByRole("tablist", { name: "Workspace tabs" });

const placement = (test: TestContainer, workspaceId: WorkspaceId, id: TerminalId) =>
	test.container.services.terminals.store
		.getState()
		.byWorkspace[workspaceId]?.find((terminal) => terminal.id === id)?.placement;

describe("RUN-01 a terminal tab drags between the bottom panel and the centre", () => {
	it("a panel terminal's tab dragged onto the centre strip moves it there", async () => {
		const ready = await setUp();
		const terminal = must(
			await ready.test.container.actions.terminals.create(ready.workspaceId, {
				placement: "panel",
			}),
		);
		const spawns = ready.test.memory.controls.ptySpawns.length;
		const mounted = await mount(ready);
		const panelTab = await within(mounted.panel).findByRole("tab", { name: "Terminal 1" });
		layOutStrips(mounted);

		dragPointer(panelTab, STRIP_END, { x: 1000, y: 516 });

		const centreTab = await within(centreStrip(mounted.centre)).findByRole("tab", {
			name: "Terminal 1",
		});
		expect(within(mounted.panel).queryByRole("tab", { name: "Terminal 1" })).toBeNull();
		expect(centreTab.closest("[data-tab-ref]")?.getAttribute("data-tab-ref")).toBe(
			`terminal:${terminal.id}`,
		);
		// The tab placed on the main strip opens, as Conductor navigates to it.
		await waitFor(() => expect(centreTab.getAttribute("aria-selected")).toBe("true"));
		expect(mounted.searches.at(-1)).toMatchObject({ tab: "terminal", terminalId: terminal.id });
		expect(placement(ready.test, ready.workspaceId, terminal.id)).toBe("centre");
		// The same shell: nothing was spawned for the move.
		expect(ready.test.memory.controls.ptySpawns.length).toBe(spawns);
	});

	it("places a panel terminal at the drop index of a strip the user reordered", async () => {
		const ready = await setUp();
		must(await ready.test.container.services.sessions.create(ready.workspaceId, CONFIG));
		must(await ready.test.container.services.sessions.start());
		must(
			await ready.test.container.actions.terminals.create(ready.workspaceId, {
				placement: "panel",
			}),
		);
		const mounted = await mount(ready);
		const strip = () => centreStrip(mounted.centre);
		await waitFor(() => expect(within(strip()).getAllByRole("tab")).toHaveLength(2));
		layOutStrips(mounted);
		const [firstChat, secondChat] = [...strip().querySelectorAll("[data-tab-ref]")];
		if (firstChat === undefined || secondChat === undefined) throw new Error("Two chat tabs.");
		const firstRef = firstChat.getAttribute("data-tab-ref");
		const secondRef = secondChat.getAttribute("data-tab-ref");

		// The second chat moves in front of the first.
		dragPointer(secondChat, { x: FIRST_TAB.left + 4, y: 20 }, middleOf(SECOND_TAB));
		await waitFor(() =>
			expect(strip().querySelector("[data-tab-ref]")?.getAttribute("data-tab-ref")).toBe(secondRef),
		);
		layOutStrips(mounted);

		// The terminal lands on the left half of the tab shown second: between the two chats.
		const panelTab = within(mounted.panel).getByRole("tab", { name: "Terminal 1" });
		dragPointer(panelTab, { x: SECOND_TAB.left + 4, y: 20 }, { x: 1000, y: 516 });

		await within(strip()).findByRole("tab", { name: "Terminal 1" });
		const order = [...strip().querySelectorAll("[data-tab-ref]")].map((tab) =>
			tab.getAttribute("data-tab-ref"),
		);
		expect(order[0]).toBe(secondRef);
		expect(order[1]?.startsWith("terminal:")).toBe(true);
		expect(order[2]).toBe(firstRef);
	});

	it("shows the panel terminal before the moved one, as Conductor's panel does", async () => {
		const ready = await setUp();
		const mounted = await mount(ready);
		const newTerminal = within(mounted.panel).getByRole("button", { name: "New terminal" });
		fireEvent.click(newTerminal);
		await within(mounted.panel).findByRole("tab", { name: "Terminal 1" });
		fireEvent.click(newTerminal);
		const second = await within(mounted.panel).findByRole("tab", { name: "Terminal 2" });
		await waitFor(() => expect(second.getAttribute("aria-selected")).toBe("true"));
		layOutStrips(mounted);

		dragPointer(second, STRIP_END, { x: 1000, y: 516 });

		await within(centreStrip(mounted.centre)).findByRole("tab", { name: "Terminal 2" });
		const first = within(mounted.panel).getByRole("tab", { name: "Terminal 1" });
		await waitFor(() => expect(first.getAttribute("aria-selected")).toBe("true"));
	});

	it("a centre terminal's tab dropped on the panel moves it there and opens it", async () => {
		const ready = await setUp();
		const terminal = must(await ready.test.container.actions.terminals.create(ready.workspaceId));
		const mounted = await mount(ready, { tab: "terminal", terminalId: terminal.id });
		const centreTab = await within(centreStrip(mounted.centre)).findByRole("tab", {
			name: "Terminal 1",
		});
		layOutStrips(mounted);

		// While a centre terminal tab is dragged, the whole panel is a drop zone.
		fireEvent.pointerDown(centreTab, { button: 0, pointerId: 1, clientX: 300, clientY: 20 });
		fireEvent.pointerMove(document, { pointerId: 1, clientX: 1100, clientY: 650 });
		expect(await within(mounted.panel).findByTestId("panel-terminal-drop-zone")).toBeTruthy();
		expect(screen.getByTestId("center-panel-drag-ghost").textContent).toBe("Terminal 1");
		fireEvent.pointerUp(document, { pointerId: 1, clientX: 1100, clientY: 650 });

		const panelTab = await within(mounted.panel).findByRole("tab", { name: "Terminal 1" });
		await waitFor(() => expect(panelTab.getAttribute("aria-selected")).toBe("true"));
		expect(within(centreStrip(mounted.centre)).queryByRole("tab", { name: "Terminal 1" })).toBe(
			null,
		);
		expect(within(mounted.panel).queryByTestId("panel-terminal-drop-zone")).toBeNull();
		expect(placement(ready.test, ready.workspaceId, terminal.id)).toBe("panel");
		// The centre opens the first tab its strip still holds: the chat.
		await waitFor(() =>
			expect(mounted.searches.at(-1)).toMatchObject({ tab: "session", sessionId: ready.chatId }),
		);
	});

	it("labels a panel terminal's drag Terminal and shows no drop zone on the panel for it", async () => {
		const ready = await setUp();
		must(
			await ready.test.container.actions.terminals.create(ready.workspaceId, {
				placement: "panel",
			}),
		);
		const mounted = await mount(ready);
		const panelTab = await within(mounted.panel).findByRole("tab", { name: "Terminal 1" });
		layOutStrips(mounted);

		fireEvent.pointerDown(panelTab, { button: 0, pointerId: 1, clientX: 1000, clientY: 516 });
		fireEvent.pointerMove(document, { pointerId: 1, clientX: 1100, clientY: 650 });

		expect((await screen.findByTestId("center-panel-drag-ghost")).textContent).toBe("Terminal");
		expect(within(mounted.panel).queryByTestId("panel-terminal-drop-zone")).toBeNull();
		fireEvent.pointerUp(document, { pointerId: 1, clientX: 1100, clientY: 650 });
		// Released on the panel it came from, it stays there.
		expect(within(mounted.panel).getByRole("tab", { name: "Terminal 1" })).toBeTruthy();
	});

	it("refuses a centre terminal when the panel already holds the most terminals allowed", async () => {
		const ready = await setUp();
		const settings = ready.test.container.services.settings;
		must(await settings.set("experimental_tab_freak_mode", true));
		for (let count = 0; count < 5; count += 1) {
			must(
				await ready.test.container.actions.terminals.create(ready.workspaceId, {
					placement: "panel",
				}),
			);
		}
		const centred = must(await ready.test.container.actions.terminals.create(ready.workspaceId));
		// Tab Freak Mode off: the limit falls to five, which the panel holds already.
		must(await settings.set("experimental_tab_freak_mode", false));
		const error = vi.spyOn(toast, "error");
		const mounted = await mount(ready, { tab: "terminal", terminalId: centred.id });
		const centreTab = await within(centreStrip(mounted.centre)).findByRole("tab", {
			name: "Terminal 6",
		});
		layOutStrips(mounted);

		dragPointer(centreTab, middleOf(PANEL), { x: 300, y: 20 });

		await waitFor(() => expect(error).toHaveBeenCalledWith("Maximum 5 terminals allowed"));
		expect(placement(ready.test, ready.workspaceId, centred.id)).toBe("centre");
		expect(within(mounted.panel).queryByRole("tab", { name: "Terminal 6" })).toBeNull();
	});

	it("with Split tabs off, a panel terminal's tab does not drag and a click still opens it", async () => {
		const ready = await setUp(false);
		const terminal = must(
			await ready.test.container.actions.terminals.create(ready.workspaceId, {
				placement: "panel",
			}),
		);
		const mounted = await mount(ready);
		const panelTab = await within(mounted.panel).findByRole("tab", { name: "Terminal 1" });
		layOutStrips(mounted);

		dragPointer(panelTab, STRIP_END, { x: 1000, y: 516 });
		fireEvent.click(panelTab);

		expect(screen.queryByTestId("center-panel-drag-ghost")).toBeNull();
		expect(placement(ready.test, ready.workspaceId, terminal.id)).toBe("panel");
		expect(within(centreStrip(mounted.centre)).queryByRole("tab", { name: "Terminal 1" })).toBe(
			null,
		);
		expect(panelTab.getAttribute("aria-selected")).toBe("true");
	});
});
