/**
 * @feature NAV-01 Panel sizes
 * Owns: the test that the app shell and the workspace frame hand the panel sizes of ui/layout-sizes.ts to the
 * resizable panels.
 * Behaviour: research/conductor/ui-dimensions.md 3 (sidebar 256px by default, 192px to 480px, collapses to 0;
 * the scripts panel collapses to its 32px tab strip).
 * Test first: with nothing saved, the shell's sidebar panel starts at 256px with a 192px minimum and a 480px maximum.
 *
 * The expected sizes are written out here on purpose. They come from the research, not from layout-sizes.ts, so
 * a changed constant fails the test. jsdom has no layout, so the real panel library cannot report a width. The
 * test wraps the two resizable components in a recorder that renders the real component with the same props,
 * and reads the props the shell and the frame pass.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountShell } from "../app/shell-test-render.tsx";
import { saveSetting } from "../app/shell-test-support.ts";
import { WorkspaceLayout } from "../features/workspace/WorkspaceLayout.tsx";
import { createTestContainer } from "../test/container.ts";
import { appShellGroupId, centreMinSize, sidebarSize } from "./layout-sizes.ts";
import type { ResizableGroupProps, ResizablePanelProps } from "./resizable.tsx";

const recorded = vi.hoisted(() => ({
	groups: [] as ResizableGroupProps[],
	panels: [] as ResizablePanelProps[],
}));

vi.mock("./resizable.tsx", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./resizable.tsx")>();
	const { createElement } = await import("react");
	return {
		...actual,
		ResizableGroup: (props: ResizableGroupProps) => {
			recorded.groups.push(props);
			return createElement(actual.ResizableGroup, props);
		},
		ResizablePanel: (props: ResizablePanelProps) => {
			recorded.panels.push(props);
			return createElement(actual.ResizablePanel, props);
		},
	};
});

/** The props the panel with this id was last rendered with. */
function panelProps(id: string): ResizablePanelProps {
	const found = recorded.panels.filter((props) => props.id === id).at(-1);
	if (found === undefined) throw new Error(`No panel "${id}" was rendered.`);
	return found;
}

beforeEach(() => {
	recorded.groups.length = 0;
	recorded.panels.length = 0;
	window.localStorage.clear();
});
afterEach(cleanup);

describe("NAV-01 panel sizes", () => {
	it("keeps Conductor's sidebar widths and its collapse to zero", async () => {
		const test = createTestContainer();
		try {
			await mountShell(test.container);

			const sidebar = panelProps("sidebar");
			expect(sidebar.defaultSize).toBe("256px");
			expect(sidebar.minSize).toBe("192px");
			expect(sidebar.maxSize).toBe("480px");
			expect(sidebar.collapsible).toBe(true);
			expect(sidebar.collapsedSize).toBe("0px");
			expect(sidebarSize.default).toBe("256px");
			expect(sidebarSize.min).toBe("192px");
			expect(sidebarSize.max).toBe("480px");
			expect(sidebarSize.collapsed).toBe("0px");
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("starts the sidebar at the saved width, and at zero when it was saved closed", async () => {
		const wide = createTestContainer();
		try {
			await saveSetting(wide.database, "left_panel_width", 300);
			await mountShell(wide.container);
			expect(panelProps("sidebar").defaultSize).toBe("300px");
		} finally {
			cleanup();
			await wide.container.stop();
			wide.close();
		}

		recorded.panels.length = 0;
		const closed = createTestContainer();
		try {
			await saveSetting(closed.database, "left_panel_visible", false);
			await saveSetting(closed.database, "left_panel_width", 300);
			await mountShell(closed.container);
			expect(panelProps("sidebar").defaultSize).toBe("0px");
		} finally {
			cleanup();
			await closed.container.stop();
			closed.close();
		}
	});

	it("keeps the centre panel wide enough to use", async () => {
		const test = createTestContainer();
		try {
			await mountShell(test.container);

			expect(panelProps("main-content").minSize).toBe("480px");
			expect(centreMinSize).toBe("480px");
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("names the shell group for its saved layout", async () => {
		const test = createTestContainer();
		try {
			await mountShell(test.container);

			const shellGroup = recorded.groups.find((props) => props.id === "app-shell");
			expect(shellGroup?.orientation).toBe("horizontal");
			// The shell keeps its sidebar in the settings table, so its group saves no layout of its own.
			expect(shellGroup?.persist).toBe(false);
			expect(appShellGroupId).toBe("app-shell");
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("collapses the scripts panel to the 32px height of its tab strip", () => {
		render(
			createElement(WorkspaceLayout, {
				workspaceId: "w1" as WorkspaceId,
				header: () => null,
				content: null,
				gitPanel: null,
				scriptsPanel: null,
			}),
		);

		const scripts = panelProps("scripts-panel");
		expect(scripts.collapsible).toBe(true);
		expect(scripts.collapsedSize).toBe("32px");
	});
});
