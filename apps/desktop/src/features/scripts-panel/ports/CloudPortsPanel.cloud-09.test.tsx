/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Tests the Ports tab's shared preview URL: the row starts off, a detected port can be chosen with
 * Conductor's "Choose preview URL port" control, and Copy preview URL asks the Worker for that port's
 * capability URL and puts it on the clipboard.
 * Test first: starts off and shares a chosen port through the Worker; choosing port 3000 and copying asks /preview-url for port 3000.
 */

import { ok } from "@conducted/shared";
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
	test.memory.controls.scriptCloud((request) =>
		request.path.endsWith("/preview-url")
			? ok({
					status: 200,
					body: JSON.stringify({ url: "https://w.example.dev/w/oslo/preview/token/3000/" }),
				})
			: null,
	);
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

describe("CLOUD-09 shared preview URL", () => {
	it("starts off and shares a chosen port through the Worker", async () => {
		const { test } = await setup();
		expect(await screen.findByText("Preview URL")).toBeTruthy();
		fireEvent.click(await screen.findByRole("button", { name: "Choose preview URL port" }));
		fireEvent.click(await screen.findByRole("button", { name: "3000" }));
		expect(screen.getByRole("button", { name: "Choose preview URL port" }).textContent).toBe(
			"3000",
		);
		fireEvent.click(await screen.findByRole("button", { name: "Copy preview URL" }));
		await waitFor(() =>
			expect(test.memory.controls.clipboardText).toBe(
				"https://w.example.dev/w/oslo/preview/token/3000/",
			),
		);
		const asked = test.memory.controls.cloudRequests.find((request) =>
			request.path.endsWith("/preview-url"),
		);
		expect(asked?.body).toEqual({ port: 3000 });
	});
});
