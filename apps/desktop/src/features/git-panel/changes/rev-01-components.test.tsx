import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangedFile } from "../../../core/api.ts";
import type { BranchCommit } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";
import { Menu, MenuContent, MenuTrigger } from "../../../ui/Menu.tsx";
import { ChangedFileList } from "./ChangedFileList.tsx";
import { ChangedFileRow } from "./ChangedFileRow.tsx";
import { ChangedFolderRow } from "./ChangedFolderRow.tsx";
import { ChangesToolbar } from "./ChangesToolbar.tsx";
import { CommitScopeList } from "./CommitScopeList.tsx";
import { buildChangedTree, type ChangedTreeNode } from "./changed-file-tree.ts";
import { ScopeBackBar } from "./ScopeBackBar.tsx";
import { TargetBranchPicker } from "./TargetBranchPicker.tsx";

vi.mock("../../../core/hooks.ts", () => ({
	useGitState: () => ({ state: "loading" }),
	useBranchCommits: () => ({ state: "ready", data: [] }),
	useWorkspace: () => ({ state: "loading" }),
	useBranches: () => ({ state: "ready", data: [] }),
	useLiveShortcut: () => null,
}));

afterEach(cleanup);

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({
	path,
	status: "modified",
	linesAdded: 1,
	linesRemoved: 1,
	binary: false,
	conflicted: false,
	viewed: false,
	...over,
});

const commit = (sha: string, subject: string): BranchCommit => ({
	sha,
	shortSha: sha.slice(0, 7),
	subject,
	authorName: "Ada",
	at: 1_700_000_000_000,
});

describe("REV-01 changed file row", () => {
	it("toggles Viewed without opening the file", () => {
		const onOpen = vi.fn();
		const onToggleViewed = vi.fn();
		render(
			<ChangedFileRow
				file={file("src/a.ts")}
				depth={0}
				selected={false}
				onOpen={onOpen}
				onToggleViewed={onToggleViewed}
			/>,
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "Viewed src/a.ts" }));
		expect(onToggleViewed).toHaveBeenCalledWith(true);
		expect(onOpen).not.toHaveBeenCalled();
	});

	it("shows a renamed file's old path and status letter", () => {
		render(
			<ChangedFileRow
				file={file("src/new.ts", { status: "renamed", oldPath: "src/old.ts" })}
				depth={1}
				selected
				onOpen={vi.fn()}
				onToggleViewed={vi.fn()}
			/>,
		);
		expect(screen.getByText("from src/old.ts")).toBeTruthy();
		expect(screen.getByText("renamed")).toBeTruthy();
		expect(screen.getByTitle("renamed").textContent).toContain("R");
	});
});

describe("REV-01 changed file row discard", () => {
	it("asks before discarding and discards only on confirm", async () => {
		const onDiscard = vi.fn();
		render(
			<ChangedFileRow
				file={file("src/a.ts")}
				depth={0}
				selected={false}
				onOpen={vi.fn()}
				onDiscard={onDiscard}
			/>,
		);
		fireEvent.contextMenu(screen.getByLabelText("Open src/a.ts"));
		fireEvent.click(await screen.findByText("Discard changes"));
		expect(onDiscard).not.toHaveBeenCalled();
		expect(await screen.findByRole("heading", { name: "Discard file changes?" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(onDiscard).toHaveBeenCalledTimes(1);
	});
});

describe("REV-01 changed folder row", () => {
	it("shows the sum of the folder's line counts", () => {
		render(
			<ChangedFolderRow
				name="src/a"
				depth={0}
				collapsed={false}
				linesAdded={5}
				linesRemoved={3}
				onToggle={vi.fn()}
			/>,
		);
		expect(screen.getByText("+5")).toBeTruthy();
		expect(screen.getByText("-3")).toBeTruthy();
	});
});

describe("REV-01 changed file list", () => {
	it("draws only the visible window of a 5,000-file list", () => {
		const files = Array.from({ length: 5_000 }, (_, index) =>
			file(`src/f${String(index).padStart(4, "0")}.ts`),
		);
		const nodes = buildChangedTree(files, "flat", new Set());
		render(
			<ChangedFileList
				nodes={nodes}
				selectedPath={null}
				onSelect={vi.fn()}
				onOpen={vi.fn()}
				onToggleViewed={vi.fn()}
				onToggleFolder={vi.fn()}
				collapsedFolders={new Set()}
			/>,
		);
		const rows = screen.getAllByRole("row");
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.length).toBeLessThan(100);
		expect(screen.queryByLabelText("Open src/f4899.ts")).toBeNull();
	});

	it("moves the selection with the arrow keys", () => {
		const files = [file("src/a.ts"), file("src/b.ts")];
		const nodes = buildChangedTree(files, "flat", new Set());
		const onSelect = vi.fn();
		render(
			<ChangedFileList
				nodes={nodes}
				selectedPath="src/a.ts"
				onSelect={onSelect}
				onOpen={vi.fn()}
				onToggleViewed={vi.fn()}
				onToggleFolder={vi.fn()}
				collapsedFolders={new Set()}
			/>,
		);
		fireEvent.keyDown(screen.getByRole("grid", { name: "Changed files" }), { key: "ArrowDown" });
		expect(onSelect).toHaveBeenCalledWith("src/b.ts");
	});
});

function ScrollHarness({ nodes }: { nodes: ChangedTreeNode[] }) {
	const [selected, setSelected] = useState<string | null>("src/f0000.ts");
	return (
		<ChangedFileList
			nodes={nodes}
			selectedPath={selected}
			onSelect={setSelected}
			onOpen={vi.fn()}
			onToggleFolder={vi.fn()}
			collapsedFolders={new Set()}
		/>
	);
}

describe("REV-01 changed file list scrolling", () => {
	it("scrolls the selected row into the window when the arrows pass its end", () => {
		const files = Array.from({ length: 200 }, (_, index) =>
			file(`src/f${String(index).padStart(4, "0")}.ts`),
		);
		const nodes = buildChangedTree(files, "flat", new Set());
		render(<ScrollHarness nodes={nodes} />);
		const grid = screen.getByRole("grid", { name: "Changed files" });
		expect(screen.queryByLabelText("Open src/f0050.ts")).toBeNull();
		for (let press = 0; press < 50; press += 1) fireEvent.keyDown(grid, { key: "ArrowDown" });
		expect(grid.scrollTop).toBeGreaterThan(0);
		const row = screen.getByLabelText("Open src/f0050.ts").closest('[role="row"]');
		expect(row?.getAttribute("aria-selected")).toBe("true");
	});
});

describe("REV-01 commit scope list", () => {
	it("renders commits in order and marks the selected one", () => {
		render(
			<Menu open>
				<MenuTrigger>Open</MenuTrigger>
				<MenuContent>
					<CommitScopeList
						commits={[
							commit("aaa1111", "First"),
							commit("bbb2222", "Second"),
							commit("ccc3333", "Third"),
						]}
						selectedSha="bbb2222"
						onSelect={vi.fn()}
					/>
				</MenuContent>
			</Menu>,
		);
		const entries = screen.getAllByRole("menuitemradio");
		expect(entries.map((entry) => entry.textContent)).toEqual([
			expect.stringContaining("First"),
			expect.stringContaining("Second"),
			expect.stringContaining("Third"),
		]);
		expect(entries[1]?.getAttribute("aria-checked")).toBe("true");
		expect(entries[0]?.getAttribute("aria-checked")).toBe("false");
	});
});

describe("REV-01 scope back bar", () => {
	it("shows the commit subject and goes back to all changes", () => {
		const onBack = vi.fn();
		render(<ScopeBackBar label="Fix the bug" onBack={onBack} />);
		expect(screen.getByText("Fix the bug")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "All changes" }));
		expect(onBack).toHaveBeenCalledTimes(1);
	});
});

describe("REV-01 target branch picker", () => {
	it("says why the list is empty when the branches could not be loaded", () => {
		render(
			<TargetBranchPicker
				branches={[]}
				current=""
				onSelect={vi.fn()}
				loading={false}
				error="git said no"
			/>,
		);
		expect(screen.getByRole("alert").textContent).toContain("git said no");
		expect(screen.queryByText("No branches match")).toBeNull();
	});

	it("narrows the list as the user types", () => {
		render(
			<TargetBranchPicker
				branches={["main", "release/1"]}
				current="main"
				onSelect={vi.fn()}
				loading={false}
				error={null}
			/>,
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Select target branch" }), {
			target: { value: "rel" },
		});
		const entries = screen.getAllByRole("option");
		expect(entries).toHaveLength(1);
		expect(entries[0]?.textContent).toContain("release/1");
	});
});

describe("REV-01 changes toolbar", () => {
	it("reports typing and clearing the filter", () => {
		const onFilterChange = vi.fn();
		render(
			<ChangesToolbar
				workspaceId={"w1" as WorkspaceId}
				filter=""
				onFilterChange={onFilterChange}
				view="flat"
				onViewChange={vi.fn()}
				scope={{ kind: "branch" }}
				onScopeChange={vi.fn()}
			/>,
		);
		// The filter opens from a search icon, as in Conductor's Changes tab.
		fireEvent.click(screen.getByRole("button", { name: "Search changed files" }));
		const input = screen.getByRole("textbox", { name: "Filter changed files" });
		fireEvent.change(input, { target: { value: "src/a" } });
		expect(onFilterChange).toHaveBeenCalledWith("src/a");
		fireEvent.keyDown(input, { key: "Escape" });
		expect(onFilterChange).toHaveBeenLastCalledWith("");
	});
});
