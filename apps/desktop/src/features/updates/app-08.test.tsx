/**
 * @feature APP-08 Wrong-build confirm and macOS warning
 * Owns: tests for the Rosetta confirm, the dismissible macOS warning, and the warning's home in the sidebar
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
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
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RosettaConfirm
							open
							onOpenChange={onOpenChange}
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
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<RosettaConfirm
							open
							onOpenChange={onOpenChange}
							system={system("arm64", "x86_64")}
							downloadUrl="https://example.test/download"
						/>
					</AppProviders>
				</ServicesProvider>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
			expect(onOpenChange).toHaveBeenCalledWith(false);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});

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
});
