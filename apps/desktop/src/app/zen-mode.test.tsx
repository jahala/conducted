/**
 * @feature NAV-12 Zen mode and panel toggles
 * Owns: tests for the zen-mode state machine and the view commands that reach the real shell.
 * Test first: entering zen mode closes both panels and leaving it reopens only the ones that were open.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
import "../test/dom-polyfills.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";
import { createShellContainer, type ShellFixture } from "./shell-test-support.ts";
import {
	enterZenMode,
	leaveZenMode,
	type ShellPanelHandles,
	toggleZenMode,
	useZenModeControls,
	useZenPanel,
	type ZenModeControls,
	ZenModeProvider,
	zenModeOff,
} from "./zen-mode.ts";

interface FakePanels {
	panels: ShellPanelHandles;
	state: { left: boolean; right: boolean | null };
}

function fakePanels(left = true, right: boolean | null = true): FakePanels {
	const state = { left, right };
	return {
		state,
		panels: {
			isSidebarOpen: () => state.left,
			setSidebarOpen: (open) => {
				state.left = open;
			},
			isRightPanelOpen: () => state.right,
			setRightPanelOpen: (open) => {
				if (state.right !== null) state.right = open;
			},
		},
	};
}

async function openApp(
	container: Parameters<typeof ServicesProvider>[0]["container"],
	path: string,
) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

async function openShellApp(path: string, fixture: ShellFixture = {}) {
	const shell = createShellContainer(fixture);
	await openApp(shell.container, path);
	return shell;
}

afterEach(cleanup);

describe("NAV-12 zen mode", () => {
	it("closes both panels and reopens only the ones that were open", () => {
		const { panels, state } = fakePanels(true, true);

		const snapshot = enterZenMode(panels);
		expect(state).toEqual({ left: false, right: false });

		leaveZenMode(snapshot, panels);
		expect(state).toEqual({ left: true, right: true });
	});

	it("leaves a panel that was closed before zen mode closed, and brings back only the open one", () => {
		const { panels, state } = fakePanels(true, false);

		const snapshot = enterZenMode(panels);
		expect(state).toEqual({ left: false, right: false });

		leaveZenMode(snapshot, panels);
		expect(state).toEqual({ left: true, right: false });
	});

	it("only closes the sidebar on a screen with no right panel", () => {
		const { panels, state } = fakePanels(true, null);

		const snapshot = enterZenMode(panels);
		expect(state).toEqual({ left: false, right: null });

		leaveZenMode(snapshot, panels);
		expect(state).toEqual({ left: true, right: null });
	});

	it("opens both panels when both are already closed, as after a restart in zen mode", () => {
		// The snapshot is not saved, so a restart in zen mode starts with both panels closed and
		// no record of them; Cmd+. then opens both, as Conductor does.
		const { panels, state } = fakePanels(false, false);

		const next = toggleZenMode(panels, zenModeOff);

		expect(next.active).toBe(false);
		expect(state).toEqual({ left: true, right: true });
	});

	it("turns on from the off state and off again", () => {
		const { panels, state } = fakePanels(true, true);

		const on = toggleZenMode(panels, zenModeOff);
		expect(on.active).toBe(true);
		expect(state).toEqual({ left: false, right: false });

		const off = toggleZenMode(panels, on);
		expect(off.active).toBe(false);
		expect(state).toEqual({ left: true, right: true });
	});
});

/** A right panel as the zen-mode provider sees it, with its open state in `state`. */
function RegisteredRightPanel({
	state,
	reached,
}: {
	state: { open: boolean };
	reached: { controls: ZenModeControls | null };
}) {
	reached.controls = useZenModeControls();
	useZenPanel("right", {
		isOpen: () => state.open,
		setOpen: (open) => {
			state.open = open;
		},
	});
	return null;
}

describe("NAV-12 the right panel's saved state", () => {
	it("saves a change the panel reports itself, such as a divider drag, once", () => {
		const saved: boolean[] = [];
		const state = { open: true };
		const reached: { controls: ZenModeControls | null } = { controls: null };
		render(
			<ZenModeProvider rightInitialOpen onRightOpenChange={(open) => saved.push(open)}>
				<RegisteredRightPanel state={state} reached={reached} />
			</ZenModeProvider>,
		);
		const zen = reached.controls as ZenModeControls;

		// The divider closes the panel: the provider did not ask, the panel tells it.
		state.open = false;
		zen.panelOpenChanged("right", false);
		zen.panelOpenChanged("right", false);
		expect(saved).toEqual([false]);

		// Cmd+Alt+B opens it again; the panel reports its new state, which is saved once too.
		zen.togglePanel("right");
		zen.panelOpenChanged("right", true);
		expect(saved).toEqual([false, true]);
	});
});

describe("NAV-12 view commands in the real shell", () => {
	it("hides both panels from Cmd+. and restores them from the same key", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			await test.container.services.settings.start();
			await openApp(test.container, `/repository/${workspace.repoId}/workspace/${workspace.id}`);

			const right = await screen.findByRole("complementary", {
				name: "Changes and scripts",
			});
			expect(right.getAttribute("data-right-panel-open")).toBe("true");
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: true }),
			).toBeTruthy();

			fireEvent.keyDown(document, { key: ".", metaKey: true });
			await waitFor(() => {
				expect(right.getAttribute("data-right-panel-open")).toBe("false");
			});
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: false }),
			).toBeTruthy();

			fireEvent.keyDown(document, { key: ".", metaKey: true });
			await waitFor(() => {
				expect(right.getAttribute("data-right-panel-open")).toBe("true");
			});
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: true }),
			).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("toggles the left and right panels with their shortcuts and saves each setting", async () => {
		const { container, settingsWrites } = await openShellApp("/repository/r1/workspace/w1");
		const right = await screen.findByRole("complementary", { name: "Changes and scripts" });

		fireEvent.keyDown(document, { key: "b", metaKey: true });
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: false }),
			).toBeTruthy();
		});
		expect(settingsWrites).toContainEqual({ key: "left_panel_visible", value: false });

		fireEvent.keyDown(document, { key: "B", metaKey: true, altKey: true });
		await waitFor(() => {
			expect(right.getAttribute("data-right-panel-open")).toBe("false");
		});
		expect(settingsWrites).toContainEqual({ key: "right_panel_visible", value: false });

		fireEvent.keyDown(document, { key: "B", metaKey: true, altKey: true });
		await waitFor(() => {
			expect(right.getAttribute("data-right-panel-open")).toBe("true");
		});
		expect(settingsWrites).toContainEqual({ key: "right_panel_visible", value: true });

		expect(container.services.settings.store.getState().values.left_panel_visible).toBe(false);
	});

	it("keeps a right panel that was closed closed when zen mode ends", async () => {
		await openShellApp("/repository/r1/workspace/w1", {
			settings: { right_panel_visible: false },
		});
		const right = await screen.findByRole("complementary", { name: "Changes and scripts" });
		await waitFor(() => {
			expect(right.getAttribute("data-right-panel-open")).toBe("false");
		});

		fireEvent.keyDown(document, { key: ".", metaKey: true });
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: false }),
			).toBeTruthy();
		});
		expect(right.getAttribute("data-right-panel-open")).toBe("false");

		fireEvent.keyDown(document, { key: ".", metaKey: true });
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: true }),
			).toBeTruthy();
		});
		expect(right.getAttribute("data-right-panel-open")).toBe("false");
	});

	it("leaves zen mode when a panel shortcut is pressed", async () => {
		await openShellApp("/repository/r1/workspace/w1");
		const right = await screen.findByRole("complementary", { name: "Changes and scripts" });

		fireEvent.keyDown(document, { key: ".", metaKey: true });
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: false }),
			).toBeTruthy();
		});

		fireEvent.keyDown(document, { key: "b", metaKey: true });
		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Toggle left sidebar", expanded: true }),
			).toBeTruthy();
		});
		expect(right.getAttribute("data-right-panel-open")).toBe("true");
	});

	it("toggles the terminal panel from Cmd+J", async () => {
		await openShellApp("/repository/r1/workspace/w1");
		const scripts = await waitFor(() => {
			const node = document.querySelector("[data-scripts-panel-open]");
			if (node === null) throw new Error("The scripts panel has not mounted.");
			return node;
		});
		expect(scripts.getAttribute("data-scripts-panel-open")).toBe("true");

		fireEvent.keyDown(document, { key: "j", metaKey: true });
		await waitFor(() => {
			expect(scripts.getAttribute("data-scripts-panel-open")).toBe("false");
		});

		fireEvent.keyDown(document, { key: "j", metaKey: true });
		await waitFor(() => {
			expect(scripts.getAttribute("data-scripts-panel-open")).toBe("true");
		});
	});
});
