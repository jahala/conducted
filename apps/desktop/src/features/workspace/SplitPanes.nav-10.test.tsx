/**
 * @feature NAV-10 Split panes
 * Owns: tests for the split gate and for dropping a tab onto the edge.
 * Test first: Dropping a tab on the right edge of a group makes two groups with the tab alone in
 * the new one.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import type { TabDescriptor } from "./tab-layout.ts";

const state = vi.hoisted(() => ({ split: false }));

const tabs: TabDescriptor[] = [
	{ kind: "session", ref: "session:one", title: "One", sessionId: "one" as SessionId },
	{ kind: "session", ref: "session:two", title: "Two", sessionId: "two" as SessionId },
];

vi.mock("../../core/hooks.ts", () => ({
	useSetting: () => state.split,
	useSessions: () => ({ state: "ready", data: [] }),
	useTerminals: () => ({ state: "ready", data: [] }),
	useWorkspace: () => ({ state: "ready", data: { prNumber: null } }),
}));

vi.mock("./TabStrip.tsx", () => ({
	TabStrip: () => <p>strip</p>,
	buildTabs: () => tabs,
}));

vi.mock("./TabContent.tsx", () => ({
	TabContent: () => <p>content</p>,
}));

vi.mock("./TabItem.tsx", () => ({
	TabItem: ({ tab }: { tab: TabDescriptor }) => <span>{tab.title}</span>,
}));

const { SplitPanes } = await import("./SplitPanes.tsx");

const workspaceId = "w1" as WorkspaceId;

afterEach(cleanup);

describe("NAV-10 SplitPanes", () => {
	it("is one group when the setting is off", () => {
		state.split = false;
		render(<SplitPanes workspaceId={workspaceId} search={{}} onSearchChange={vi.fn()} />);
		expect(screen.getByText("strip")).toBeTruthy();
		expect(screen.getByText("content")).toBeTruthy();
	});

	it("opens a dropped tab in a second group on the right edge", () => {
		state.split = true;
		render(<SplitPanes workspaceId={workspaceId} search={{}} onSearchChange={vi.fn()} />);
		fireEvent.drop(screen.getByTestId("split-centre"), {
			dataTransfer: {
				getData: () => "session:two",
				types: ["application/x-conducted-tab"],
			},
		});
		expect(screen.getByRole("region", { name: "Split pane: Two" })).toBeTruthy();
	});
});
