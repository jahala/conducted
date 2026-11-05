/**
 * @feature test support The test container works under jsdom
 * Owns: proof that a component test can build the real container, seed it and read it through
 * ServicesProvider.
 * Behaviour: not applicable, test support only.
 * Must handle: the migrations folder is found when `import.meta.url` is not a file URL.
 * Test first: a component renders the name of a seeded workspace.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "zustand";
import { ServicesProvider, useServices } from "../core/context.tsx";
import { createTestContainer, seedWorkspace } from "./container.ts";

afterEach(cleanup);

function WorkspaceNames() {
	const store = useServices().services.workspace.store;
	const workspaces = useStore(store, (state) => state.workspacesById);
	return (
		<ul>
			{Object.values(workspaces).map((workspace) => (
				<li key={workspace.id}>{workspace.directoryName}</li>
			))}
		</ul>
	);
}

describe("test container under jsdom", () => {
	it("renders a seeded workspace read through ServicesProvider", async () => {
		const test = createTestContainer();
		try {
			const seeded = await seedWorkspace(test.container, { directoryName: "jsdom-workspace" });
			render(
				<ServicesProvider container={test.container}>
					<WorkspaceNames />
				</ServicesProvider>,
			);
			expect(await screen.findByText("jsdom-workspace")).toBeTruthy();
			expect(seeded.directoryName).toBe("jsdom-workspace");
		} finally {
			test.close();
		}
	});
});
