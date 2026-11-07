/**
 * @feature NAV-10 Split panes
 * Owns: tests for the split gate, the four drop edges, moving a tab to another strip, closing a
 * pane, the live-tab derivation, the workspace reset and Cmd+D.
 * Test first: Dropping a tab on the right edge of a group makes two groups with the tab alone in
 * the new one.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandRegistryProvider, createCommandRegistry } from "../../app/command-dispatcher.ts";
import type { TabDescriptor } from "./tab-layout.ts";

const state = vi.hoisted(() => {
	const sessionsSnapshot = { liveStates: {}, cancelling: {} };
	const sessionsStore = {
		getState: () => sessionsSnapshot,
		getInitialState: () => sessionsSnapshot,
		subscribe: () => () => {},
		setState: () => {},
	};
	const reviewSnapshot = { byWorkspace: {} };
	const reviewStore = {
		getState: () => reviewSnapshot,
		getInitialState: () => reviewSnapshot,
		subscribe: () => () => {},
		setState: () => {},
	};
	return {
		split: false,
		tabs: [] as TabDescriptor[],
		sessions: { state: "ready", data: [] },
		terminals: { state: "ready", data: [] },
		workspace: { state: "ready", data: { prNumber: null } },
		sessionsStore,
		reviewStore,
	};
});

const session = (id: string, title: string): TabDescriptor => ({
	kind: "session",
	ref: `session:${id}`,
	title,
	sessionId: id as SessionId,
});

vi.mock("../../core/hooks.ts", () => ({
	useSetting: () => state.split,
	useSessions: () => state.sessions,
	useTerminals: () => state.terminals,
	useWorkspace: () => state.workspace,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({
		services: {
			sessions: { store: state.sessionsStore },
			review: { store: state.reviewStore },
		},
	}),
}));

vi.mock("./TabStrip.tsx", () => ({
	TabStrip: () => <p>strip</p>,
	buildTabs: () => state.tabs,
}));

vi.mock("./TabContent.tsx", () => ({
	TabContent: ({
		tab,
	}: {
		tab?: { kind: string; mode?: string; scope?: { kind: string }; line?: number | null };
	}) =>
		tab === undefined ? (
			<p>content</p>
		) : (
			<p>
				override {tab.kind} {tab.mode ?? ""} {tab.scope?.kind ?? ""} {tab.line ?? ""}
			</p>
		),
}));

vi.mock("./TabItem.tsx", () => ({
	TabItem: ({ tab }: { tab: TabDescriptor }) => <span>{tab.title}</span>,
}));

const { SplitPanes } = await import("./SplitPanes.tsx");

const workspaceId = "w1" as WorkspaceId;

const renderPanes = ({
	split = true,
	withRegistry = false,
	workspace = workspaceId,
	search = {},
}: {
	split?: boolean;
	withRegistry?: boolean;
	workspace?: WorkspaceId;
	search?: Parameters<typeof SplitPanes>[0]["search"];
} = {}) => {
	state.split = split;
	const registry = createCommandRegistry();
	const element = createElement(SplitPanes, {
		workspaceId: workspace,
		search,
		onSearchChange: vi.fn(),
	});
	const rendered = render(
		withRegistry ? createElement(CommandRegistryProvider, { registry }, element) : element,
	);
	return { ...rendered, registry };
};

const dropOn = (
	element: HTMLElement,
	ref: string,
	coords: { clientX?: number; clientY?: number } = {},
) => {
	// jsdom has no DragEvent, so the drop carries its coordinates on a MouseEvent instead.
	const event = new MouseEvent("drop", {
		bubbles: true,
		cancelable: true,
		clientX: coords.clientX ?? 0,
		clientY: coords.clientY ?? 0,
	});
	Object.defineProperty(event, "dataTransfer", {
		value: {
			getData: () => ref,
			types: ["application/x-conducted-tab"],
		},
	});
	fireEvent(element, event);
};

/** True when `first` comes before `second` in the page. */
const precedes = (first: HTMLElement, second: HTMLElement) =>
	(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const withRect = (element: HTMLElement) => {
	vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
		left: 0,
		top: 0,
		width: 100,
		height: 100,
		right: 100,
		bottom: 100,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});
};

beforeEach(() => {
	state.split = true;
	state.tabs = [session("one", "One"), session("two", "Two")];
	state.sessions = { state: "ready", data: [] };
	state.terminals = { state: "ready", data: [] };
	state.workspace = { state: "ready", data: { prNumber: null } };
});

afterEach(cleanup);

describe("NAV-10 SplitPanes", () => {
	it("is one group when the setting is off", () => {
		renderPanes({ split: false });
		expect(screen.getByText("strip")).toBeTruthy();
		expect(screen.getByText("content")).toBeTruthy();
		expect(screen.queryByTestId("split-centre")).toBeNull();
	});

	// WorkspaceLayout puts the centre in a block, so `flex-1` alone gives it no height and the chat
	// list collapses to nothing. jsdom has no layout, so the test reads the class that fills the height.
	it.each([
		["off", false],
		["on, with one group", true],
	])("fills the height of its parent with the setting %s", (_label, split) => {
		const { container } = renderPanes({ split });
		const pane = container.firstElementChild;
		expect(pane?.classList.contains("h-full")).toBe(true);
	});

	it("opens a dropped tab in a second group on the right edge", () => {
		renderPanes();
		dropOn(screen.getByTestId("split-centre"), "session:two");
		expect(screen.getByRole("region", { name: "Split pane: Two" })).toBeTruthy();
	});

	it("splits on the left edge", () => {
		renderPanes();
		const centre = screen.getByTestId("split-centre");
		withRect(centre);
		dropOn(centre, "session:two", { clientX: 5, clientY: 50 });
		const pane = screen.getByRole("region", { name: "Split pane: Two" });
		expect(document.querySelector('[data-direction="row"]')).not.toBeNull();
		expect(precedes(pane, screen.getByText("content"))).toBe(true);
	});

	it("splits on the right edge", () => {
		renderPanes();
		const centre = screen.getByTestId("split-centre");
		withRect(centre);
		dropOn(centre, "session:two", { clientX: 95, clientY: 50 });
		const pane = screen.getByRole("region", { name: "Split pane: Two" });
		expect(document.querySelector('[data-direction="row"]')).not.toBeNull();
		expect(precedes(screen.getByText("content"), pane)).toBe(true);
	});

	it("splits on the top edge", () => {
		renderPanes();
		const centre = screen.getByTestId("split-centre");
		withRect(centre);
		dropOn(centre, "session:two", { clientX: 50, clientY: 5 });
		const pane = screen.getByRole("region", { name: "Split pane: Two" });
		expect(document.querySelector('[data-direction="column"]')).not.toBeNull();
		expect(precedes(pane, screen.getByText("content"))).toBe(true);
	});

	it("splits on the bottom edge", () => {
		renderPanes();
		const centre = screen.getByTestId("split-centre");
		withRect(centre);
		dropOn(centre, "session:two", { clientX: 50, clientY: 95 });
		const pane = screen.getByRole("region", { name: "Split pane: Two" });
		expect(document.querySelector('[data-direction="column"]')).not.toBeNull();
		expect(precedes(screen.getByText("content"), pane)).toBe(true);
	});

	it("moves a tab dropped on another group's strip", () => {
		renderPanes();
		dropOn(screen.getByTestId("split-centre"), "session:two");
		const strip = screen.getByTestId("split-group-group-session:two");
		dropOn(strip, "session:one");
		expect(screen.getByRole("region", { name: "Split pane: One" })).toBeTruthy();
	});

	it("closes the split pane without closing its tab", () => {
		renderPanes();
		dropOn(screen.getByTestId("split-centre"), "session:two");
		fireEvent.click(screen.getByRole("button", { name: "Close split pane" }));
		expect(screen.queryByRole("region", { name: "Split pane: Two" })).toBeNull();
	});

	it("stops showing a split tab once the live tab is gone", () => {
		const { rerender } = renderPanes();
		dropOn(screen.getByTestId("split-centre"), "session:two");
		state.tabs = [session("one", "One")];
		rerender(<SplitPanes workspaceId={workspaceId} search={{}} onSearchChange={vi.fn()} />);
		expect(screen.queryByRole("region", { name: "Split pane: Two" })).toBeNull();
	});

	it("clears the split when the workspace changes", async () => {
		const { rerender } = renderPanes();
		dropOn(screen.getByTestId("split-centre"), "session:two");
		rerender(<SplitPanes workspaceId={"w2" as WorkspaceId} search={{}} onSearchChange={vi.fn()} />);
		await waitFor(() =>
			expect(screen.queryByRole("region", { name: "Split pane: Two" })).toBeNull(),
		);
	});

	it("refuses Cmd+D with only one tab", () => {
		state.tabs = [session("one", "One")];
		const { registry } = renderPanes({
			withRegistry: true,
			search: { tab: "session", sessionId: "one" },
		});
		expect(registry.run("tab.split")).toBe(false);
		expect(screen.queryByRole("region", { name: "Split pane: One" })).toBeNull();
	});

	it("splits the active tab with Cmd+D", () => {
		const { registry } = renderPanes({
			withRegistry: true,
			search: { tab: "session", sessionId: "one" },
		});
		act(() => {
			expect(registry.run("tab.split")).toBe(true);
		});
		expect(screen.getByRole("region", { name: "Split pane: One" })).toBeTruthy();
	});

	it("opens a file split with its own mode, scope and line", () => {
		state.tabs = [
			session("one", "One"),
			{
				kind: "file",
				ref: "file:a.ts",
				title: "a.ts",
				mode: "edit",
				scope: { kind: "target", branch: "main" },
				line: 12,
			},
		];
		renderPanes();
		dropOn(screen.getByTestId("split-centre"), "file:a.ts");
		expect(screen.getByText(/override file edit target 12/)).toBeTruthy();
	});
});
