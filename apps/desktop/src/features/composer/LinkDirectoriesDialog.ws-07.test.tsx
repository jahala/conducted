/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: tests of the Link workspaces and directories dialog over the real container.
 * Behaviour: ui-map.md 3.10; Conductor's picker (renderApp @5683700 to @5688200): a search over
 * the workspaces of other repositories grouped by repository, a Directories group with "Browse..."
 * and the linked folders, and "No workspaces found" for a search that matches none. Each pick links
 * or unlinks at once.
 * Test first: Browse... links the folder the system picker returns.
 */
import { appError, err, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { LinkDirectoriesDialog } from "./LinkDirectoriesDialog.tsx";

let active: TestContainer | undefined;

afterEach(() => {
	vi.restoreAllMocks();
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

async function setup(linkedPaths: string[] = []) {
	const test = createTestContainer();
	active = test;
	const home = await seedRepo(test.container, { name: "atlas" });
	const elsewhere = await seedRepo(test.container, { name: "relay" });
	const workspace = await seedWorkspace(test.container, { repoId: home.id, linkedPaths });
	const sibling = await seedWorkspace(test.container, {
		repoId: home.id,
		directoryName: "lisbon",
	});
	const other = await seedWorkspace(test.container, {
		repoId: elsewhere.id,
		directoryName: "oslo",
		branch: "sam/queue-metrics",
	});
	return { test, workspace, sibling, other };
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
	it("links the folder Browse... picks, at once, with Conductor's picker title", async () => {
		const { test, workspace } = await setup();
		test.memory.controls.queueDialogAnswers({ folder: "/code/shared" });
		const pickFolder = vi.spyOn(test.memory.platform.dialogs, "pickFolder");
		renderDialog(test, workspace.id);

		fireEvent.click(await screen.findByRole("option", { name: /Browse\.\.\./ }));

		await waitFor(async () =>
			expect(await linkedPathsInDatabase(test, workspace.id)).toEqual(["/code/shared"]),
		);
		// The system folder picker's title, as Conductor's (renderApp @5685048, D134).
		expect(pickFolder).toHaveBeenCalledWith(
			expect.objectContaining({ title: "Select directory to link" }),
		);
		const directories = screen.getByRole("group", { name: "Directories" });
		expect(await within(directories).findByText("/code/shared")).toBeTruthy();
	});

	it("lists only other repositories' workspaces, under their repository, and links one", async () => {
		const { test, workspace, sibling, other } = await setup();
		renderDialog(test, workspace.id);

		const relay = await screen.findByRole("group", { name: "relay" });
		expect(screen.queryByRole("option", { name: new RegExp(sibling.directoryName) })).toBeNull();
		fireEvent.click(within(relay).getByRole("option", { name: /oslo/ }));

		await waitFor(async () =>
			expect(await linkedPathsInDatabase(test, workspace.id)).toEqual([other.path]),
		);
		expect(await within(relay).findByText("Unlink")).toBeTruthy();
	});

	it("unlinks a linked folder when it is picked again", async () => {
		const { test, workspace } = await setup(["/code/shared"]);
		renderDialog(test, workspace.id);

		const directories = await screen.findByRole("group", { name: "Directories" });
		fireEvent.click(within(directories).getByRole("option", { name: /shared/ }));

		await waitFor(async () => expect(await linkedPathsInDatabase(test, workspace.id)).toEqual([]));
	});

	it("says No workspaces found when the search matches none", async () => {
		const { test, workspace } = await setup();
		renderDialog(test, workspace.id);

		fireEvent.change(await screen.findByPlaceholderText("Search workspaces..."), {
			target: { value: "no-such-place" },
		});

		expect(await screen.findByText("No workspaces found")).toBeTruthy();
	});

	it("finds a workspace by its branch or its repository's name", async () => {
		const { test, workspace } = await setup();
		renderDialog(test, workspace.id);
		const search = await screen.findByPlaceholderText("Search workspaces...");

		fireEvent.change(search, { target: { value: "queue-metrics" } });
		expect(await screen.findByRole("option", { name: /oslo/ })).toBeTruthy();

		fireEvent.change(search, { target: { value: "relay" } });
		expect(await screen.findByRole("option", { name: /oslo/ })).toBeTruthy();
	});

	it("says why a link could not be saved", async () => {
		const { test, workspace } = await setup();
		vi.spyOn(test.container.actions.workspaces, "setLinkedPaths").mockResolvedValue(
			err(appError("db_busy", "The database is locked.")),
		);
		const error = vi.spyOn(toast, "error");
		renderDialog(test, workspace.id);

		fireEvent.click(await screen.findByRole("option", { name: /oslo/ }));

		await waitFor(() =>
			expect(error).toHaveBeenCalledWith(
				"Couldn't save the linked directories",
				expect.objectContaining({ description: "The database is locked." }),
			),
		);
	});

	it("leaves the links alone when the folder picker is cancelled", async () => {
		const { test, workspace } = await setup(["/code/shared"]);
		test.memory.controls.queueDialogAnswers({ folder: null });
		const pickFolder = vi.spyOn(test.memory.platform.dialogs, "pickFolder");
		const save = vi.spyOn(test.container.actions.workspaces, "setLinkedPaths");
		renderDialog(test, workspace.id);

		fireEvent.click(await screen.findByRole("option", { name: /Browse\.\.\./ }));

		await waitFor(() => expect(pickFolder).toHaveBeenCalledTimes(1));
		expect(await pickFolder.mock.results[0]?.value).toBeNull();
		expect(save).not.toHaveBeenCalled();
		expect(await linkedPathsInDatabase(test, workspace.id)).toEqual(["/code/shared"]);
	});
});
