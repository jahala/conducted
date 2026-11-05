/**
 * @feature RUN-03 Ports tab
 * Owns: tests for the list of detected ports and its empty state.
 * Test first: with detectedPorts [3000, 5173] two rows render in ascending order.
 */
import { appError, ok } from "@conducted/shared";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunState } from "../../../core/api.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { Workspace } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { renderWithRouter } from "../../../test/render-with-router.tsx";
import { PortsTab } from "./PortsTab.tsx";

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	for (const test of containers.splice(0)) test.close();
});

const runWith = (ports: RunState["detectedPorts"]): RunState => ({
	actions: [],
	running: [],
	spotlight: { active: false, terminalId: null },
	detectedPorts: ports,
});

async function setup(ports: RunState["detectedPorts"], workspacePort = 55_000) {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id, port: workspacePort });
	test.container.services.runScripts.store.setState((state) => ({
		...state,
		byWorkspace: { ...state.byWorkspace, [workspace.id]: runWith(ports) },
	}));
	return { test, workspace };
}

function renderTab(test: ReturnType<typeof createTestContainer>, workspace: Workspace) {
	return renderWithRouter(
		<ServicesProvider container={test.container}>
			<PortsTab workspaceId={workspace.id} />
		</ServicesProvider>,
	);
}

describe("RUN-03 ports tab", () => {
	it("renders the detected ports in ascending order", async () => {
		const { test, workspace } = await setup([
			{ port: 5173, pid: 2, processName: "vite", appName: null },
			{ port: 3000, pid: 1, processName: "node", appName: null },
		]);

		renderTab(test, workspace);

		const rows = await screen.findAllByText(/^localhost:\d+$/);
		expect(rows.map((row) => row.textContent)).toEqual(["localhost:3000", "localhost:5173"]);
	});

	it("marks the workspace's own port", async () => {
		const { test, workspace } = await setup(
			[
				{ port: 55000, pid: 1, processName: "node", appName: null },
				{ port: 3000, pid: 2, processName: "vite", appName: null },
			],
			55_000,
		);

		renderTab(test, workspace);

		await screen.findByText("localhost:55000");
		expect(screen.getByText("Workspace port")).toBeTruthy();
	});

	it("shows why a failed scan left no ports", async () => {
		const { test, workspace } = await setup([]);
		test.container.services.runScripts.store.setState((state) => ({
			...state,
			portErrors: {
				...state.portErrors,
				[workspace.id]: appError("ports_unavailable", "lsof could not be run."),
			},
		}));

		renderTab(test, workspace);

		expect(await screen.findByText("Ports are unavailable")).toBeTruthy();
		expect(screen.getByText("lsof could not be run.")).toBeTruthy();
	});

	it("shows the designed empty state when nothing is listening", async () => {
		const { test, workspace } = await setup([]);

		renderTab(test, workspace);

		expect(await screen.findByText("No local servers running")).toBeTruthy();
		expect(screen.getByText("Start your dev server and it'll show up here.")).toBeTruthy();
	});

	it("opens a port in the system browser", async () => {
		const { test, workspace } = await setup([
			{ port: 3000, pid: 1, processName: "node", appName: null },
		]);
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderTab(test, workspace);
		fireEvent.click(await screen.findByRole("button", { name: /Open in browser/ }));

		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("activates the app that owns a port", async () => {
		const { test, workspace } = await setup([
			{ port: 3000, pid: 1, processName: "Electron", appName: "My App" },
		]);
		const activate = vi
			.spyOn(test.container.services.runScripts, "activateApp")
			.mockResolvedValue(ok(undefined));

		renderTab(test, workspace);
		fireEvent.click(await screen.findByRole("button", { name: /Activate My App/ }));

		expect(activate).toHaveBeenCalledWith(workspace.id, 3000);
	});

	it("copies the URL", async () => {
		const { test, workspace } = await setup([
			{ port: 3000, pid: 1, processName: "node", appName: null },
		]);
		const writeText = vi.spyOn(test.container.platform.clipboard, "writeText");

		renderTab(test, workspace);
		fireEvent.click(await screen.findByRole("button", { name: "Copy URL" }));

		expect(writeText).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("does not offer the in-app preview while its setting is off", async () => {
		const { test, workspace } = await setup([
			{ port: 3000, pid: 1, processName: "node", appName: null },
		]);

		renderTab(test, workspace);

		await screen.findByText("localhost:3000");
		expect(screen.queryByRole("button", { name: /Open in preview/ })).toBeNull();
	});

	it("drops a port from the list when it closes", async () => {
		const { test, workspace } = await setup([
			{ port: 3000, pid: 1, processName: "node", appName: null },
			{ port: 5173, pid: 2, processName: "vite", appName: null },
		]);

		renderTab(test, workspace);
		expect(await screen.findAllByText(/^localhost:\d+$/)).toHaveLength(2);

		test.container.services.runScripts.store.setState((state) => ({
			...state,
			byWorkspace: {
				...state.byWorkspace,
				[workspace.id]: runWith([{ port: 3000, pid: 1, processName: "node", appName: null }]),
			},
		}));

		expect(await screen.findAllByText(/^localhost:\d+$/)).toHaveLength(1);
	});
});
