/**
 * @feature APP-07 Resource usage table
 * Owns: tests for the sidebar's resource chip and its Resources popover over the real container:
 * the setting, the chip's memory and widths, the heading and summary, the grouped tree, sorting,
 * "Show all", the four header buttons, a process that exits, an unreadable process table, and the
 * high-memory log line that runs on an interval.
 * Behaviour: ui-map.md 1.3, 4 item 8 and 5.2.
 * Test first: with the setting on, the popover lists App first with Main's Sidecar under Main,
 * then each workspace, sorted by memory, with "Show all (n)" once more than seven processes show.
 */
import { appError, err } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ShellControls } from "../../app/ShellControls.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { MemoryProcess } from "../../platform/memory.ts";
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

function renderTable(
	test: TestContainer,
	props: { pollIntervalMs?: number; sidebarWidth?: number } = {},
): void {
	render(
		<AppProviders client={createQueryClient(() => {})}>
			<ServicesProvider container={test.container}>
				<ResourceUsageTable {...props} />
			</ServicesProvider>
		</AppProviders>,
	);
}

async function openPopover(test: TestContainer): Promise<HTMLElement> {
	setSetting(test, "sidebar_resource_usage", true);
	renderTable(test, { sidebarWidth: 320 });
	fireEvent.click(await screen.findByRole("button", { name: /^Resource usage/ }));
	return screen.findByRole("dialog");
}

/** Made-up processes shaped like the owner's screenshot of Conductor, in two workspaces. */
async function seedProcesses(test: TestContainer): Promise<void> {
	const oslo = await seedWorkspace(test.container, {
		branch: "oslo",
		directoryName: "oslo",
		path: "/code/workspaces/oslo",
	});
	const athens = await seedWorkspace(test.container, {
		branch: "athens",
		directoryName: "athens",
		path: "/code/workspaces/athens",
	});
	const rows: MemoryProcess[] = [
		{ pid: 100, ppid: 1, label: "Main", cpuPercent: 3, memoryBytes: 189 * MB, cwd: "/" },
		{ pid: 200, ppid: 1, label: "Renderer", cpuPercent: 10.1, memoryBytes: 1040 * MB, cwd: "/" },
		{ pid: 300, ppid: 1, label: "Networking", cpuPercent: 0, memoryBytes: 9 * MB, cwd: "/" },
		{ pid: 101, ppid: 100, label: "Sidecar", cpuPercent: 0, memoryBytes: 133 * MB, cwd: "/" },
		{ pid: 102, ppid: 101, label: "claude", cpuPercent: 4, memoryBytes: 400 * MB, cwd: oslo.path },
		{ pid: 103, ppid: 102, label: "node", cpuPercent: 0.5, memoryBytes: 60 * MB, cwd: oslo.path },
		{
			pid: 104,
			ppid: 101,
			label: "claude",
			cpuPercent: 1,
			memoryBytes: 300 * MB,
			cwd: athens.path,
		},
		{ pid: 105, ppid: 104, label: "rg", cpuPercent: 0, memoryBytes: 8 * MB, cwd: athens.path },
		{
			pid: 106,
			ppid: 100,
			label: "zsh",
			cpuPercent: 0,
			memoryBytes: 5 * MB,
			cwd: athens.path,
			terminalId: "term-1",
		},
	];
	test.memory.controls.setProcesses(rows);
}

/** The text of each body row, in order. */
const rowTexts = (popover: HTMLElement): string[] =>
	within(popover)
		.getAllByRole("row")
		.slice(1)
		.map((row) => row.textContent ?? "");

describe("APP-07 resource usage chip and popover", () => {
	it("renders nothing when Show sidebar resource usage is off", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		renderTable(test, { sidebarWidth: 320 });
		await act(async () => {});
		expect(screen.queryByRole("button", { name: /^Resource usage/ })).toBeNull();
	});

	it("names the app's own memory on the chip, leaving out agents and terminals", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		setSetting(test, "sidebar_resource_usage", true);
		renderTable(test, { sidebarWidth: 320 });
		// Main, Renderer, Networking and Sidecar: 1371 MB. Both claudes, what they started and zsh
		// are left out.
		const chip = await screen.findByRole("button", { name: "Resource usage: 1.34 GB" });
		expect(chip.textContent).toBe("1.34 GB");
		expect(chip.title).toBe("");
	});

	it("shows only the chip's icon on a narrow sidebar, and no chip on a very narrow one", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		setSetting(test, "sidebar_resource_usage", true);
		renderTable(test, { sidebarWidth: 240 });
		const chip = await screen.findByRole("button", { name: "Resource usage: 1.34 GB" });
		expect(chip.textContent).toBe("");
		expect(chip.title).toBe("Resource usage: 1.34 GB");
		cleanup();

		renderTable(test, { sidebarWidth: 190 });
		await act(async () => {});
		expect(screen.queryByRole("button", { name: /^Resource usage/ })).toBeNull();
	});

	it("heads the popover Resources, sums the shown processes and lists App's tree first", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		expect(within(popover).getByText("Resources", { selector: "p" })).toBeTruthy();
		// Every process but the terminal's zsh: 18.6% and 2.09 GB.
		expect(within(popover).getByText("Memory").parentElement?.textContent).toBe(
			"CPU 18.6% Memory 2.09 GB",
		);
		expect(rowTexts(popover)).toEqual([
			"App13.1%1.34 GB",
			"Renderer10.1%1.02 GB",
			"Main3.0%189.0 MB",
			"Sidecar0.0%133.0 MB",
			"Networking0.0%9.0 MB",
			"athens1.0%308.0 MB",
			"claude1.0%300.0 MB",
			"rg0.0%8.0 MB",
			"oslo4.5%460.0 MB",
			"claude4.0%400.0 MB",
			"node0.5%60.0 MB",
		]);
		const mem = within(popover).getByRole("columnheader", { name: "Mem" });
		expect(mem.getAttribute("aria-sort")).toBe("descending");
	});

	it("collapses a group from its row", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		const app = within(popover).getByRole("button", { name: "App" });
		expect(app.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(app);
		expect(app.getAttribute("aria-expanded")).toBe("false");
		expect(within(popover).queryByText("Renderer")).toBeNull();
		expect(within(popover).getByText("oslo")).toBeTruthy();
	});

	it("sorts by a column, flipping it when chosen again", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		fireEvent.click(within(popover).getByRole("button", { name: "Name" }));
		expect(
			within(popover).getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort"),
		).toBe("ascending");
		expect(rowTexts(popover).slice(0, 5)).toEqual([
			"App13.1%1.34 GB",
			"Main3.0%189.0 MB",
			"Sidecar0.0%133.0 MB",
			"Networking0.0%9.0 MB",
			"Renderer10.1%1.02 GB",
		]);

		fireEvent.click(within(popover).getByRole("button", { name: "Name" }));
		expect(
			within(popover).getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort"),
		).toBe("descending");
		expect(rowTexts(popover)[1]).toBe("Renderer10.1%1.02 GB");
	});

	it("offers Show all past seven processes, and Show less once open", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		const showAll = within(popover).getByRole("button", { name: "Show all (8)" });
		fireEvent.click(showAll);
		expect(within(popover).getByRole("button", { name: "Show less" })).toBeTruthy();
	});

	it("has no Show all with seven processes or fewer", async () => {
		const test = createTestContainer();
		open = test;
		test.memory.controls.setProcesses(
			[1, 2, 3, 4, 5, 6, 7].map((pid) => ({
				pid,
				label: `p${pid}`,
				cpuPercent: 0,
				memoryBytes: MB,
				cwd: "/",
			})),
		);
		const popover = await openPopover(test);
		expect(within(popover).queryByRole("button", { name: /^Show all/ })).toBeNull();
	});

	it("includes the terminals' processes when asked", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		expect(within(popover).queryByText("zsh")).toBeNull();
		const include = within(popover).getByRole("button", { name: "Include terminal processes" });
		expect(include.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(include);
		expect(within(popover).getByText("zsh")).toBeTruthy();
		expect(within(popover).getByRole("button", { name: "Show all (9)" })).toBeTruthy();
		const exclude = within(popover).getByRole("button", { name: "Exclude terminal processes" });
		expect(exclude.getAttribute("aria-pressed")).toBe("true");
	});

	it("ungroups the processes into one list", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		fireEvent.click(within(popover).getByRole("button", { name: "Ungroup processes" }));
		expect(within(popover).queryByRole("button", { name: "App" })).toBeNull();
		// One tree over every process: the claudes sit under Sidecar, so Main's subtree (1090 MB)
		// now outweighs Renderer (1040 MB).
		expect(rowTexts(popover)).toEqual([
			"Main3.0%189.0 MB",
			"Sidecar0.0%133.0 MB",
			"claude4.0%400.0 MB",
			"node0.5%60.0 MB",
			"claude1.0%300.0 MB",
			"rg0.0%8.0 MB",
			"Renderer10.1%1.02 GB",
			"Networking0.0%9.0 MB",
		]);
		expect(within(popover).getByRole("button", { name: "Group by workspace" })).toBeTruthy();
	});

	it("switches the tree to a flat list sorted by each process's own numbers", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		fireEvent.click(within(popover).getByRole("button", { name: "Switch to flat view" }));
		expect(rowTexts(popover).slice(0, 5)).toEqual([
			"App13.1%1.34 GB",
			"Renderer10.1%1.02 GB",
			"Main3.0%189.0 MB",
			"Sidecar0.0%133.0 MB",
			"Networking0.0%9.0 MB",
		]);
		const sidecar = within(popover).getByText("Sidecar");
		const main = within(popover).getByText("Main");
		// In the tree Sidecar is indented under Main; flat, both start at the same place.
		expect(sidecar.style.paddingLeft).toBe(main.style.paddingLeft);
		expect(within(popover).getByRole("button", { name: "Switch to tree view" })).toBeTruthy();
	});

	it("copies the summary and one line per process, in the tree's order over every process", async () => {
		const test = createTestContainer();
		open = test;
		await seedProcesses(test);
		const popover = await openPopover(test);

		fireEvent.click(within(popover).getByRole("button", { name: "Copy resource usage" }));
		await waitFor(() => expect(test.memory.controls.clipboardText).toContain("Sidecar"));
		expect((test.memory.controls.clipboardText ?? "").split("\n").slice(0, 3)).toEqual([
			"CPU 18.6% Memory 2.09 GB",
			"Main 3.0% 189.0 MB (pid=100 ppid=1)",
			"Sidecar 0.0% 133.0 MB (pid=101 ppid=100)",
		]);
		expect(test.memory.controls.clipboardText).toContain(
			"claude 4.0% 400.0 MB (pid=102 ppid=101 ws=oslo)",
		);
	});

	it("shows no chip while the process table cannot be read", async () => {
		const test = createTestContainer();
		open = test;
		vi.spyOn(test.memory.platform.app, "resourceUsage").mockResolvedValue(
			err(appError("resource_usage_failed", "The process table could not be read.")),
		);
		setSetting(test, "sidebar_resource_usage", true);
		vi.useFakeTimers();
		renderTable(test, { pollIntervalMs: 1000, sidebarWidth: 320 });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		expect(screen.queryByRole("button", { name: /^Resource usage/ })).toBeNull();
		// Three failed readings in a row write one log line.
		const failures = test.memory.controls.logs.filter(
			(line) => line.message === "Resource usage could not be read",
		);
		expect(failures).toHaveLength(1);
	});

	it("drops a process that is gone on the next poll", async () => {
		const test = createTestContainer();
		open = test;
		test.memory.controls.setProcesses([
			{ pid: 1, label: "Main", cpuPercent: 1, memoryBytes: 10 * MB, cwd: "/" },
			{ pid: 2, ppid: 1, label: "rg", cpuPercent: 1, memoryBytes: 10 * MB, cwd: "/" },
		]);
		vi.useFakeTimers();
		setSetting(test, "sidebar_resource_usage", true);
		renderTable(test, { pollIntervalMs: 1000, sidebarWidth: 320 });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		fireEvent.click(screen.getByRole("button", { name: /^Resource usage/ }));
		expect(screen.getByText("rg")).toBeTruthy();

		test.memory.controls.setProcesses([
			{ pid: 1, label: "Main", cpuPercent: 1, memoryBytes: 10 * MB, cwd: "/" },
		]);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(screen.queryByText("rg")).toBeNull();
	});

	it("logs a heavy process again on the next poll", async () => {
		vi.useFakeTimers();
		const test = createTestContainer();
		open = test;
		test.memory.controls.setProcesses([
			{ pid: 91, label: "hog", cpuPercent: 4, memoryBytes: 700 * MB, cwd: "/tmp/hog" },
		]);
		renderTable(test, { pollIntervalMs: 1000 });
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

	// Conductor mounts the chip in the sidebar's top strip before Go back (renderApp @10538807).
	it("is reachable from the top strip, before Go back", async () => {
		const test = createTestContainer();
		open = test;
		test.memory.controls.setProcesses([
			{ pid: 1, label: "Main", cpuPercent: 1, memoryBytes: 10 * MB, cwd: "/" },
		]);
		setSetting(test, "sidebar_resource_usage", true);
		renderWithRouter(
			<AppProviders client={createQueryClient(() => {})}>
				<ServicesProvider container={test.container}>
					<ShellControls
						sidebarOpen
						onToggleSidebar={() => {}}
						resources={<ResourceUsageTable sidebarWidth={320} />}
					/>
				</ServicesProvider>
			</AppProviders>,
		);
		const chip = await screen.findByRole("button", { name: /^Resource usage/ });
		const back = screen.getByRole("button", { name: "Go back" });
		expect(chip.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
