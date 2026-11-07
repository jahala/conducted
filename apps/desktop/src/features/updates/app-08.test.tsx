/**
 * @feature APP-08 Wrong-build confirm and macOS warning
 * Owns: tests for the Rosetta confirm (only "Continue anyway" continues), the dismissible macOS warning (one
 * reader of the machine facts, storage that fails on read or write), and the warning's home in the sidebar
 * footer.
 * Behaviour: ui-map.md 1.3, 4.8, 5.2 and 7.4.
 * Test first: with machineArch "arm64" and buildArch "x86_64" the dialog opens and offers the download; with
 * equal values it renders nothing.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { useSystemInfo } from "../../core/hooks.ts";
import { createTestContainer } from "../../test/container.ts";
import { Sidebar } from "../sidebar/Sidebar.tsx";
import { MacosVersionWarning } from "./MacosVersionWarning.tsx";
import { isWrongCpuBuild, RosettaConfirm } from "./RosettaConfirm.tsx";

const system = (machineArch: "arm64" | "x86_64", buildArch: "arm64" | "x86_64") => ({
	osVersion: "15.0",
	machineArch,
	buildArch,
});

beforeEach(() => {
	window.localStorage.clear();
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("APP-08 RosettaConfirm", () => {
	it("opens for an Intel build on Apple silicon and offers the right download", async () => {
		const test = createTestContainer();
		try {
			const openUrl = vi.spyOn(test.memory.platform.opener, "openUrl");
			const onOpenChange = vi.fn();
			const onContinue = vi.fn();
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RosettaConfirm
							open
							onOpenChange={onOpenChange}
							onContinue={onContinue}
							system={system("arm64", "x86_64")}
							downloadUrl="https://example.test/download"
						/>
					</AppProviders>
				</ServicesProvider>,
			);

			expect(
				screen.getByRole("heading", { name: "Wrong version of Conducted for this Mac" }),
			).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Download for Apple silicon" }));
			await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://example.test/download"));
			await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
			expect(onContinue).not.toHaveBeenCalled();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("renders nothing when the Mac and the build agree", async () => {
		const test = createTestContainer();
		try {
			expect(isWrongCpuBuild(system("arm64", "arm64"))).toBe(false);
			expect(isWrongCpuBuild(system("x86_64", "x86_64"))).toBe(false);
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RosettaConfirm
							open
							onOpenChange={() => {}}
							onContinue={() => {}}
							system={system("arm64", "arm64")}
							downloadUrl="https://example.test/download"
						/>
					</AppProviders>
				</ServicesProvider>,
			);
			expect(
				screen.queryByRole("heading", { name: "Wrong version of Conducted for this Mac" }),
			).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("explains the mismatch without a download button when no page is known", async () => {
		const test = createTestContainer();
		try {
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RosettaConfirm
							open
							onOpenChange={() => {}}
							onContinue={() => {}}
							system={system("arm64", "x86_64")}
							downloadUrl={null}
						/>
					</AppProviders>
				</ServicesProvider>,
			);
			expect(screen.queryByRole("button", { name: "Download for Apple silicon" })).toBeNull();
			expect(screen.getByRole("button", { name: "Continue anyway" })).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("closes through Continue anyway", async () => {
		const test = createTestContainer();
		try {
			const onOpenChange = vi.fn();
			const onContinue = vi.fn();
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RosettaConfirm
							open
							onOpenChange={onOpenChange}
							onContinue={onContinue}
							system={system("arm64", "x86_64")}
							downloadUrl="https://example.test/download"
						/>
					</AppProviders>
				</ServicesProvider>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
			expect(onOpenChange).toHaveBeenCalledWith(false);
			expect(onContinue).toHaveBeenCalledTimes(1);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});

/** Mounts the real Sidebar, whose footer holds the warning, over the test container. */
function renderSidebar(
	test: ReturnType<typeof createTestContainer>,
	client = createQueryClient(() => {}),
	extra: ReactNode = null,
) {
	const root = createRootRoute({ component: Sidebar });
	const settingsRoute = createRoute({
		getParentRoute: () => root,
		path: "/settings",
		component: () => null,
	});
	const router = createRouter({
		routeTree: root.addChildren([settingsRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={client}>
				{extra}
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	return router;
}

/** Reads the machine facts the way the start-up root in main.tsx does. */
function StartupProbe() {
	const system = useSystemInfo();
	return <p>{system.state === "ready" ? `build ${system.data.buildArch}` : "reading"}</p>;
}

describe("APP-08 MacosVersionWarning", () => {
	it("warns on an old macOS and stays quiet at the minimum", () => {
		const { rerender } = render(
			<MacosVersionWarning
				system={{ ...system("arm64", "arm64"), osVersion: "13.6.1" }}
				minimumOsVersion="14.0"
				dismissed={false}
				onDismiss={() => {}}
			/>,
		);
		expect(screen.getByText(/macOS 13.6.1 is too old/)).toBeTruthy();

		rerender(
			<MacosVersionWarning
				system={{ ...system("arm64", "arm64"), osVersion: "14.0" }}
				minimumOsVersion="14.0"
				dismissed={false}
				onDismiss={() => {}}
			/>,
		);
		expect(screen.queryByText(/is too old/)).toBeNull();
	});

	it("hides after the dismiss button and stays hidden on the next launch", async () => {
		const test = createTestContainer();
		test.memory.controls.setSystemInfo({
			osVersion: "13.6.1",
			machineArch: "arm64",
			buildArch: "arm64",
		});
		const root = createRootRoute({ component: Sidebar });
		const settingsRoute = createRoute({
			getParentRoute: () => root,
			path: "/settings",
			component: () => null,
		});
		const router = createRouter({
			routeTree: root.addChildren([settingsRoute]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		const ui = () => (
			<ServicesProvider container={test.container}>
				<AppProviders client={createQueryClient(() => {})}>
					<RouterProvider router={router} />
				</AppProviders>
			</ServicesProvider>
		);
		try {
			const first = render(ui());
			await router.load();
			expect(await screen.findByText(/macOS 13.6.1 is too old/)).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Dismiss macOS version warning" }));
			await waitFor(() => expect(screen.queryByText(/macOS 13.6.1 is too old/)).toBeNull());

			first.unmount();
			render(ui());
			await router.load();
			expect(screen.queryByText(/macOS 13.6.1 is too old/)).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
	it("reads the machine facts once, through the query the start-up root uses", async () => {
		const test = createTestContainer();
		test.memory.controls.setSystemInfo({
			osVersion: "13.6.1",
			machineArch: "arm64",
			buildArch: "arm64",
		});
		const info = vi.spyOn(test.memory.platform.system, "info");
		try {
			const router = renderSidebar(
				test,
				createQueryClient(() => {}),
				<StartupProbe />,
			);
			await router.load();
			expect(await screen.findByText(/macOS 13.6.1 is too old/)).toBeTruthy();
			expect(await screen.findByText("build arm64")).toBeTruthy();
			expect(info).toHaveBeenCalledTimes(1);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("shows the warning when the stored dismissal cannot be read", async () => {
		const test = createTestContainer();
		test.memory.controls.setSystemInfo({
			osVersion: "13.6.1",
			machineArch: "arm64",
			buildArch: "arm64",
		});
		// seam: APP-08 the web view's storage is the outside world here; it throws when storage is turned off
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("The storage is turned off");
		});
		try {
			const router = renderSidebar(test);
			await router.load();
			expect(await screen.findByText(/macOS 13.6.1 is too old/)).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("says so when the dismissal cannot be saved, and hides the warning for this run", async () => {
		const test = createTestContainer();
		test.memory.controls.setSystemInfo({
			osVersion: "13.6.1",
			machineArch: "arm64",
			buildArch: "arm64",
		});
		// seam: APP-08 the web view's storage is the outside world here; a full storage throws on write
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("The storage is full");
		});
		try {
			const router = renderSidebar(test);
			await router.load();
			fireEvent.click(await screen.findByRole("button", { name: "Dismiss macOS version warning" }));
			expect(
				await screen.findByText("Couldn't remember that you dismissed the macOS warning"),
			).toBeTruthy();
			expect(screen.getByText("The storage is full")).toBeTruthy();
			expect(screen.queryByText(/macOS 13.6.1 is too old/)).toBeNull();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});
