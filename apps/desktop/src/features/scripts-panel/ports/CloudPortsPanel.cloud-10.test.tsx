/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Tests the Ports tab of a cloud workspace through the real container: the Forward ports popover
 * lists discovered ports, and Start forwarding turns the workspace's switch on.
 * Test first: lists the detected ports in the Forward ports popover.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { renderWithRouter } from "../../../test/render-with-router.tsx";
import { PortsTab } from "./PortsTab.tsx";

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	for (const test of containers.splice(0)) test.close();
});

async function setup() {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, {
		repoId: repo.id,
		host: { kind: "cloud", url: "https://w.example.dev", vmId: "oslo" },
	});
	test.container.services.portForwards.store.setState({
		byWorkspace: {
			[workspace.id]: {
				forwardingEnabled: false,
				autoForwardEnabled: false,
				waiting: false,
				forwards: [],
				detectedPorts: [
					{ port: 3000, processName: "node" },
					{ port: 5173, processName: "vite" },
				],
				error: null,
			},
		},
	});
	renderWithRouter(
		<ServicesProvider container={test.container}>
			<PortsTab workspaceId={workspace.id} />
		</ServicesProvider>,
	);
	return { test, workspace };
}

describe("CLOUD-10 cloud Ports tab", () => {
	it("lists the detected ports in the Forward ports popover", async () => {
		await setup();
		fireEvent.click(await screen.findByRole("button", { name: "Forward ports" }));
		expect(await screen.findByText(/localhost:3000/)).toBeTruthy();
		expect(screen.getByText(/localhost:5173/)).toBeTruthy();
		expect(screen.getByText("node")).toBeTruthy();
		expect(screen.getByText("vite")).toBeTruthy();
	});

	it("Start forwarding turns the workspace's switch on", async () => {
		const { test, workspace } = await setup();
		fireEvent.click(await screen.findByRole("button", { name: /Start forwarding/ }));
		await waitFor(() =>
			expect(test.container.services.portForwards.view(workspace.id).forwardingEnabled).toBe(true),
		);
	});
});
