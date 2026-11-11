/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Tests that a cloud workspace's scripts panel always offers the Ports tab, even before the sandbox
 * reports a listening port: Start forwarding and the shared preview URL live there.
 * Test first: is offered before the sandbox reports a port.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { WithSurfaces } from "../../test/surfaces.tsx";
import { ScriptsPanel } from "./ScriptsPanel.tsx";

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	for (const test of containers.splice(0)) test.close();
});

describe("CLOUD-09 cloud Ports tab", () => {
	it("is offered before the sandbox reports a port", async () => {
		const test = createTestContainer();
		containers.push(test);
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, {
			repoId: repo.id,
			host: { kind: "cloud", url: "https://w.example.dev", vmId: "oslo" },
		});
		test.container.services.workspace.store.setState((state) => ({
			workspacesById: {
				...state.workspacesById,
				[workspace.id]: { ...workspace, state: "ready" },
			},
		}));
		render(
			<ServicesProvider container={test.container}>
				<WithSurfaces>
					<ScriptsPanel workspaceId={workspace.id} />
				</WithSurfaces>
			</ServicesProvider>,
		);
		expect(await screen.findByRole("tab", { name: "Ports" })).toBeTruthy();
	});
});
