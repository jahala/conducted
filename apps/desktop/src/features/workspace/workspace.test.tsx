import { appError } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { Workspace } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";
import { ArchivedNotice } from "./ArchivedNotice.tsx";
import { WorkspaceLayout } from "./WorkspaceLayout.tsx";
import { WorkspaceStatusIcon } from "./WorkspaceStatusIcon.tsx";

const state = vi.hoisted(() => ({
	workspace: { state: "loading" } as Loadable<Workspace>,
	unarchive: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useWorkspace: () => state.workspace,
	useActions: () => ({ workspaces: { unarchive: state.unarchive } }),
}));

const { WorkspaceGate } = await import("./WorkspaceGate.tsx");

beforeEach(() => state.unarchive.mockReset());
afterEach(cleanup);

const ws = (workspaceState: Workspace["state"]) =>
	({ id: "w1", state: workspaceState }) as Workspace;
const id = "w1" as Parameters<typeof WorkspaceGate>[0]["workspaceId"];

describe("WorkspaceGate", () => {
	it("announces loading", () => {
		state.workspace = { state: "loading" };
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByRole("status", { name: "Loading workspace" })).toBeTruthy();
	});

	it("explains a workspace that cannot be opened", () => {
		state.workspace = { state: "error", error: appError("not_found", "Workspace not found") };
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByText("Couldn't open this workspace")).toBeTruthy();
		expect(screen.getByText("Workspace not found")).toBeTruthy();
	});

	it("shows the tabs for a ready workspace", () => {
		state.workspace = { state: "ready", data: ws("ready") };
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.getByText("content")).toBeTruthy();
	});

	it("shows the archived notice and unarchives on request", () => {
		state.workspace = { state: "ready", data: ws("archived") };
		state.unarchive.mockResolvedValue({ ok: true, value: undefined });
		render(<WorkspaceGate workspaceId={id}>content</WorkspaceGate>);
		expect(screen.queryByText("content")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
		expect(state.unarchive).toHaveBeenCalledWith(id);
	});
});

describe("ArchivedNotice", () => {
	it("calls onUnarchive and disables the button while busy", () => {
		const onUnarchive = vi.fn();
		const { rerender } = render(<ArchivedNotice onUnarchive={onUnarchive} busy={false} />);
		fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
		expect(onUnarchive).toHaveBeenCalledTimes(1);
		rerender(<ArchivedNotice onUnarchive={onUnarchive} busy />);
		expect((screen.getByRole("button", { name: /Unarchive/ }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
});

describe("WorkspaceLayout", () => {
	it("renders every slot and hands the header the right panel controls", () => {
		render(
			<WorkspaceLayout
				workspaceId={id}
				header={(controls) => <p>header open={String(controls.rightPanelOpen)}</p>}
				tabStrip={<p>tabs</p>}
				content={<p>content</p>}
				gitPanel={<p>git</p>}
				scriptsPanel={<p>scripts</p>}
			/>,
		);
		for (const text of ["header open=true", "tabs", "content", "git", "scripts"]) {
			expect(screen.getByText(text)).toBeTruthy();
		}
		expect(screen.getByRole("complementary", { name: "Changes and scripts" })).toBeTruthy();
	});
});

describe("WorkspaceStatusIcon", () => {
	it("announces active work", () => {
		render(<WorkspaceStatusIcon status={{ kind: "agent", label: "working" }} />);
		expect(screen.getByRole("status", { name: "Working…" })).toBeTruthy();
	});
	it("stays quiet for a settled workspace", () => {
		const { container } = render(<WorkspaceStatusIcon status={{ kind: "git", label: "clean" }} />);
		expect(container.querySelector("[role=status]")).toBeNull();
		expect(container.querySelector("[aria-hidden=true]")).not.toBeNull();
	});
});
