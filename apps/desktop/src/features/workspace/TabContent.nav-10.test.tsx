/**
 * @feature NAV-10 Tab content
 * Owns: tests that the URL's tab chooses the content and that no tab shows the empty group.
 * Test first: search { tab: "pr" } renders the PR tab area; {} renders the empty tab group.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";

const state = vi.hoisted(() => ({
	createFromDefaults: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useActions: () => ({ terminals: { create: vi.fn() } }),
	useWorkspace: () => ({ state: "ready", data: { port: 0 } }),
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { sessions: { createFromDefaults: state.createFromDefaults } } }),
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
});
