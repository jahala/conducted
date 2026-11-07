/**
 * @feature NAV-10 Workspace screen
 * Owns: tests that the workspace route puts every region in place.
 * Test first: renders the header, tab strip, content, Git panel and Scripts panel regions for a
 * workspace id.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

vi.mock("./WorkspaceHeader.tsx", () => ({
	WorkspaceHeader: () => <p>header region</p>,
}));
vi.mock("./SplitPanes.tsx", () => ({
	SplitPanes: () => <p>tabs and content region</p>,
}));
vi.mock("../git-panel/GitPanel.tsx", () => ({
	GitPanel: () => <p>git panel region</p>,
}));
vi.mock("../scripts-panel/ScriptsPanel.tsx", () => ({
	ScriptsPanel: () => <p>scripts panel region</p>,
}));
vi.mock("./WorkspaceGate.tsx", () => ({
	WorkspaceGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { WorkspaceScreen } = await import("./WorkspaceScreen.tsx");

let open: TestContainer | null = null;

afterEach(() => {
	cleanup();
	open?.close();
	open = null;
});

describe("NAV-10 WorkspaceScreen", () => {
	it("renders every region for a workspace", () => {
		// The screen listens for files opened from the Git panel (REV-08), through the container.
		open = createTestContainer();
		render(
			<ServicesProvider container={open.container}>
				<WorkspaceScreen
					repoId={"r1" as RepoId}
					workspaceId={"w1" as WorkspaceId}
					search={{}}
					onSearchChange={vi.fn()}
				/>
			</ServicesProvider>,
		);
		expect(screen.getByText("header region")).toBeTruthy();
		expect(screen.getByText("tabs and content region")).toBeTruthy();
		expect(screen.getByText("git panel region")).toBeTruthy();
		expect(screen.getByText("scripts panel region")).toBeTruthy();
		expect(screen.getByRole("complementary", { name: "Changes and scripts" })).toBeTruthy();
	});
});
