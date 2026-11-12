/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: tests of the Link workspaces and directories dialog over the real container.
 * Behaviour: ui-map.md 3.10 ("Link workspaces and directories", "Select working directories",
 * "Link a directory or workspace").
 * Test first: choosing a folder and saving stores its path on the workspace.
 */
import { appError, err, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { LinkDirectoriesDialog } from "./LinkDirectoriesDialog.tsx";

let active: TestContainer | undefined;

afterEach(() => {
	cleanup();
	active?.close();
	active = undefined;
});

const linkedPathsInDatabase = async (test: TestContainer, id: string): Promise<string[]> => {
	const rows = await test.database.select<{ linked_paths: string }>(
		"SELECT linked_paths FROM workspaces WHERE id = $1",
		[id],
	);
	return JSON.parse(rows[0]?.linked_paths ?? "[]") as string[];
};

async function setup() {
	const test = createTestContainer();
	active = test;
	const workspace = await seedWorkspace(test.container);
	const other = await seedWorkspace(test.container, { repoId: workspace.repoId });
	return { test, workspace, other };
}

const renderDialog = (test: TestContainer, workspaceId: string, onOpenChange = vi.fn()) => {
	render(
		<ServicesProvider container={test.container}>
			<LinkDirectoriesDialog
				open
				onOpenChange={onOpenChange}
				workspaceId={workspaceId as WorkspaceId}
			/>
		</ServicesProvider>,
	);
	return onOpenChange;
};

describe("WS-07 Link workspaces and directories dialog", () => {
	it("shows the dialog's two ways to link a folder", async () => {
		const { test, workspace } = await setup();

		renderDialog(test, workspace.id);

		expect(
			await screen.findByRole("heading", { name: "Link workspaces and directories" }),
		).toBeTruthy();
		expect(screen.getByText("Link a directory or workspace")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Select working directories" })).toBeTruthy();
	});

	it("saves a folder chosen from the system picker", async () => {
		const { test, workspace } = await setup();
		test.memory.controls.queueDialogAnswers({ folder: "/code/shared" });
		const pickFolder = vi.spyOn(test.memory.platform.dialogs, "pickFolder");
		const onOpenChange = renderDialog(test, workspace.id);

		fireEvent.click(screen.getByRole("button", { name: "Select working directories" }));
		expect(await screen.findByText("/code/shared")).toBeTruthy();
		// The system folder picker's title, as Conductor's (renderApp @5685048, D132).
		expect(pickFolder).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Select directory to link" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(await linkedPathsInDatabase(test, workspace.id)).toEqual(["/code/shared"]);
		expect(
			test.container.services.workspace.store.getState().workspacesById[workspace.id]?.linkedPaths,
		).toEqual(["/code/shared"]);
	});

	it("links another workspace as its folder path", async () => {
		const { test, workspace, other } = await setup();
		const onOpenChange = renderDialog(test, workspace.id);

		fireEvent.click(await screen.findByRole("checkbox", { name: other.directoryName }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(await linkedPathsInDatabase(test, workspace.id)).toEqual([other.path]);
	});

	it("unlinks a folder that is already linked", async () => {
		const { test } = await setup();
		const workspace = await seedWorkspace(test.container, { linkedPaths: ["/code/shared"] });
		const onOpenChange = renderDialog(test, workspace.id);

		fireEvent.click(await screen.findByRole("button", { name: "Unlink /code/shared" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(await linkedPathsInDatabase(test, workspace.id)).toEqual([]);
	});

	it("keeps the dialog open and shows why a save failed", async () => {
		const { test, workspace } = await setup();
		vi.spyOn(test.container.actions.workspaces, "setLinkedPaths").mockResolvedValue(
			err(appError("db_busy", "The database is locked.")),
		);
		const onOpenChange = renderDialog(test, workspace.id);

		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("The database is locked.")).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});

	it("keeps a cancelled folder picker from changing the list", async () => {
		const { test, workspace } = await setup();
		test.memory.controls.queueDialogAnswers({ folder: null });
		const onOpenChange = renderDialog(test, workspace.id);

		fireEvent.click(screen.getByRole("button", { name: "Select working directories" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(await linkedPathsInDatabase(test, workspace.id)).toEqual([]);
	});
});
