/**
 * @feature NAV-10 Tab content
 * Owns: tests that the URL's tab chooses the content and that no tab shows the empty group.
 * Test first: search { tab: "pr" } renders the PR tab area; {} renders the empty tab group.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	createFromDefaults: vi.fn(),
	throwChat: false,
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ terminals: { create: vi.fn() } }),
	useWorkspace: () => ({ state: "ready", data: { port: 0, host: { kind: "local" } } }),
	useSessions: () => ({ state: "ready", data: [] }),
	useSetting: () => false,
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { sessions: { createFromDefaults: state.createFromDefaults } } }),
}));

vi.mock("../chat/ChatPane.tsx", () => ({
	ChatPane: () => {
		if (state.throwChat) throw new Error("The chat pane broke.");
		return <p>chat pane</p>;
	},
}));

const { TabContent } = await import("./TabContent.tsx");

const workspaceId = "w1" as WorkspaceId;

afterEach(cleanup);

describe("NAV-10 TabContent", () => {
	it("shows the PR tab area for a PR tab", () => {
		render(
			<TabContent workspaceId={workspaceId} search={{ tab: "pr" }} onSearchChange={vi.fn()} />,
		);
		expect(screen.getByText("Pull request")).toBeTruthy();
	});

	it("shows the empty tab group when no tab is open", () => {
		render(<TabContent workspaceId={workspaceId} search={{}} onSearchChange={vi.fn()} />);
		expect(screen.getByText("No tab is open")).toBeTruthy();
		expect(screen.getByRole("button", { name: "New chat" })).toBeTruthy();
	});

	it("shows the split pane's own tab over the URL", () => {
		render(
			<TabContent
				workspaceId={workspaceId}
				search={{}}
				onSearchChange={vi.fn()}
				tab={{ kind: "pr" }}
			/>,
		);
		expect(screen.getByText("Pull request")).toBeTruthy();
		expect(screen.queryByText("No tab is open")).toBeNull();
	});

	it("shows the chat failure card when the chat tab throws", () => {
		state.throwChat = true;
		render(
			<TabContent
				workspaceId={workspaceId}
				search={{ tab: "session", sessionId: "s1" }}
				onSearchChange={vi.fn()}
			/>,
		);
		expect(screen.getByText(/This chat tab failed to render/)).toBeTruthy();
		state.throwChat = false;
	});

	it("mounts a fresh chat pane when another chat is chosen", () => {
		// A new DOM node means the pane was mounted again, not updated in place.
		const view = render(
			<TabContent
				workspaceId={workspaceId}
				search={{ tab: "session", sessionId: "s1" }}
				onSearchChange={vi.fn()}
			/>,
		);
		const first = screen.getByText("chat pane");
		view.rerender(
			<TabContent
				workspaceId={workspaceId}
				search={{ tab: "session", sessionId: "s2" }}
				onSearchChange={vi.fn()}
			/>,
		);
		expect(screen.getByText("chat pane")).not.toBe(first);
	});
});
