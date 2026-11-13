/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: tests of the linked folders shown above the composer, over the real container.
 * Test first: a linked folder shows its name and path above the composer, and its X unlinks it.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { LinkedDirectoryChips } from "./LinkedDirectoryChips.tsx";

let active: TestContainer | undefined;

afterEach(() => {
	cleanup();
	active?.close();
	active = undefined;
});

function renderChips(test: TestContainer, workspaceId: WorkspaceId) {
	render(
		<ServicesProvider container={test.container}>
			<LinkedDirectoryChips workspaceId={workspaceId} />
		</ServicesProvider>,
	);
}

describe("WS-07 linked folders above the composer", () => {
	it("shows a linked folder's name and path, with Conductor's tooltip, and unlinks it", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container, { linkedPaths: ["/code/shared-ui"] });
		renderChips(test, workspace.id);

		expect(await screen.findByText("shared-ui")).toBeTruthy();
		expect(screen.getByText("/code/shared-ui")).toBeTruthy();
		const chip = screen.getByText("shared-ui").closest("button") as HTMLButtonElement;
		fireEvent.focus(chip);
		expect(
			(
				await screen.findAllByText(
					"Files from this directory are accessible to the agent in this workspace.",
				)
			).length,
		).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "Unlink directory shared-ui" }));

		await waitFor(() =>
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.linkedPaths,
			).toEqual([]),
		);
	});

	it("shows nothing when no folder is linked, and leaves a linked workspace to its own row", async () => {
		const test = createTestContainer();
		active = test;
		const other = await seedWorkspace(test.container);
		const workspace = await seedWorkspace(test.container, { linkedPaths: [other.path] });
		const { container } = render(
			<ServicesProvider container={test.container}>
				<LinkedDirectoryChips workspaceId={workspace.id} />
			</ServicesProvider>,
		);

		await waitFor(() =>
			expect(test.container.services.workspace.store.getState().loaded).toBe(true),
		);
		expect(container.textContent).toBe("");
	});
});
