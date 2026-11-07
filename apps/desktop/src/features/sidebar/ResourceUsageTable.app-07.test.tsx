/**
 * @feature APP-07 Resource usage table
 * Owns: tests for the sidebar resource table over the real container: the setting, rows grouped by
 * workspace, sorting by a column, copying the table, the unreadable process table, and the
 * high-memory log line that runs on an interval.
 * Behaviour: ui-map.md 1.3, 4 item 8 and 5.2.
 * Test first: with the setting on and two workspaces' processes, rows are grouped by workspace and
 * sorted by memory when that header is chosen.
 */
import { appError, err } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ShellControls } from "../../app/ShellControls.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { ResourceUsageTable } from "./ResourceUsageTable.tsx";

const MB = 1024 * 1024;

let open: TestContainer | null = null;

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	open?.close();
	open = null;
});

function setSetting(test: TestContainer, key: string, value: boolean): void {
	test.container.services.settings.store.setState((state) => ({
		...state,
		values: { ...state.values, [key]: value },
	}));
}

function renderTable(test: TestContainer, pollIntervalMs?: number): void {
	render(
		<AppProviders client={createQueryClient(() => {})}>
			<ServicesProvider container={test.container}>
				<ResourceUsageTable pollIntervalMs={pollIntervalMs} />
			</ServicesProvider>
		</AppProviders>,
	);
}

async function openTable(test: TestContainer): Promise<HTMLElement> {
	setSetting(test, "sidebar_resource_usage", true);
	renderTable(test);
	fireEvent.click(screen.getByRole("button", { name: /^Resource usage/ }));
	return screen.findByRole("table", { name: "Resources" });
}

describe("APP-07 resource usage table", () => {
	it("renders nothing when Show sidebar resource usage is off", () => {
		const test = createTestContainer();
		open = test;
		renderTable(test);
		expect(screen.queryByRole("button", { name: /^Resource usage/ })).toBeNull();
	});

	it("groups rows by workspace and sorts by memory when that header is chosen", async () => {
		const test = createTestContainer();
		open = test;
		const alpha = await seedWorkspace(test.container, {
			branch: "alpha",
			branchIsPlaceholder: false,
			path: "/code/workspaces/alpha",
		});
		const beta = await seedWorkspace(test.container, {
			branch: "beta",
			branchIsPlaceholder: false,
			path: "/code/workspaces/beta",
		});
		test.memory.controls.setProcesses([
			{ pid: 1, name: "node", cpuPercent: 12.5, memoryBytes: 50 * MB, cwd: `${alpha.path}/app` },
			{ pid: 2, name: "zsh", cpuPercent: 1, memoryBytes: 100 * MB, cwd: alpha.path },
			{ pid: 3, name: "bun", cpuPercent: 3, memoryBytes: 200 * MB, cwd: beta.path },
		]);

		const table = await openTable(test);
		// Conductor's chip names the total memory of every process listed.
		expect(screen.getByRole("button", { name: /^Resource usage: 350/ })).toBeTruthy();
		const alphaGroup = within(table).getByRole("rowgroup", { name: "Alpha" });
		const betaGroup = within(table).getByRole("rowgroup", { name: "Beta" });
		expect(within(alphaGroup).getByText("node")).toBeTruthy();
		expect(within(alphaGroup).getByText("zsh")).toBeTruthy();
		expect(within(alphaGroup).queryByText("bun")).toBeNull();
		expect(within(betaGroup).getByText("bun")).toBeTruthy();

		const alphaText = alphaGroup.textContent ?? "";
		expect(alphaText.indexOf("node")).toBeLessThan(alphaText.indexOf("zsh"));

		fireEvent.click(within(table).getByRole("button", { name: "Sort by memory" }));
		const sorted = within(table).getByRole("rowgroup", { name: "Alpha" }).textContent ?? "";
		expect(sorted.indexOf("zsh")).toBeLessThan(sorted.indexOf("node"));
	});

	it("copies the grouped table as plain text", async () => {
		const test = createTestContainer();
		open = test;
		const alpha = await seedWorkspace(test.container, {
			branch: "alpha",
			branchIsPlaceholder: false,
			path: "/code/workspaces/alpha",
		});
		test.memory.controls.setProcesses([
			{ pid: 1, name: "node", cpuPercent: 12.5, memoryBytes: 50 * MB, cwd: alpha.path },
		]);

		await openTable(test);
		fireEvent.click(screen.getByRole("button", { name: "Copy resource usage" }));
		await waitFor(() => expect(test.memory.controls.clipboardText).toContain("node"));
		const copied = test.memory.controls.clipboardText ?? "";
		expect(copied).toContain("Alpha");
		expect(copied).toContain("Name");
		expect(copied).toContain("CPU");
		expect(copied).toContain("Mem");
	});

	it("says so when the process table cannot be read", async () => {
		const test = createTestContainer();
		open = test;
		vi.spyOn(test.memory.platform.app, "resourceUsage").mockResolvedValue(
			err(appError("resource_usage_failed", "The process table could not be read.")),
		);

		setSetting(test, "sidebar_resource_usage", true);
		renderTable(test);
		fireEvent.click(screen.getByRole("button", { name: /^Resource usage/ }));
		expect(await screen.findByText(/Couldn't read resource usage/)).toBeTruthy();
	});

	it("drops a process that is gone on the next poll", async () => {
		const test = createTestContainer();
		open = test;
		const alpha = await seedWorkspace(test.container, {
			branch: "alpha",
			branchIsPlaceholder: false,
			path: "/code/workspaces/alpha",
		});
		test.memory.controls.setProcesses([
			{ pid: 1, name: "node", cpuPercent: 1, memoryBytes: 10 * MB, cwd: alpha.path },
			{ pid: 2, name: "zsh", cpuPercent: 1, memoryBytes: 10 * MB, cwd: alpha.path },
		]);
		vi.useFakeTimers();
		setSetting(test, "sidebar_resource_usage", true);
		renderTable(test, 1000);
		fireEvent.click(screen.getByRole("button", { name: /^Resource usage/ }));
		expect(screen.getByRole("status", { name: "Loading resource usage" })).toBeTruthy();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(screen.queryByRole("status", { name: "Loading resource usage" })).toBeNull();
		expect(screen.getByText("zsh")).toBeTruthy();

		test.memory.controls.setProcesses([
			{ pid: 1, name: "node", cpuPercent: 1, memoryBytes: 10 * MB, cwd: alpha.path },
		]);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(screen.queryByText("zsh")).toBeNull();
	});

	it("logs a heavy process again on the next poll", async () => {
		vi.useFakeTimers();
		const test = createTestContainer();
		open = test;
		test.memory.controls.setProcesses([
			{ pid: 91, name: "hog", cpuPercent: 4, memoryBytes: 700 * MB, cwd: "/tmp/hog" },
		]);
		renderTable(test, 1000);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		const heavy = () => test.memory.controls.logs.filter((line) => line.message.includes("hog"));
		expect(heavy()).toHaveLength(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(heavy()).toHaveLength(2);
	});

	// Conductor mounts the chip in the sidebar's top strip before Go back (renderApp @10538807);
	// this test asserted the old footer row.
	it("is reachable from the top strip, before Go back", async () => {
		const test = createTestContainer();
		open = test;
		setSetting(test, "sidebar_resource_usage", true);
		renderWithRouter(
			<AppProviders client={createQueryClient(() => {})}>
				<ServicesProvider container={test.container}>
					<ShellControls
						sidebarOpen
						onToggleSidebar={() => {}}
						resources={<ResourceUsageTable />}
					/>
				</ServicesProvider>
			</AppProviders>,
		);
		const chip = await screen.findByRole("button", { name: /^Resource usage/ });
		const back = screen.getByRole("button", { name: "Go back" });
		expect(chip.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
