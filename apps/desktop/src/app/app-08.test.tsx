/**
 * @feature APP-08 Start-up screens
 * Owns: tests for the loading screen and the three full-window blockers, plus the real app entry showing a
 * blocked screen.
 * Behaviour: ui-map.md 7.3 and 7.4.
 * Test first: with phase "sidecar" the screen has role "status", the name "Starting Conducted", and shows
 * the sidecar phase text.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { createMemoryPlatform } from "../platform/memory.ts";
import { createTestContainer } from "../test/container.ts";
import { openTestDatabase } from "../test/sqlite.ts";
import { AppProviders, createQueryClient } from "./providers.tsx";
import "../test/dom-polyfills.ts";
import { type StartedApp, startApp } from "../main.tsx";
import { StartupFailure, type StartupFailureProps } from "./StartupFailure.tsx";
import { StartupScreen } from "./StartupScreen.tsx";

const callbacks = () => ({
	onUpdate: vi.fn(),
	onRetry: vi.fn(),
	onCopyDiagnostics: vi.fn(),
	onQuit: vi.fn(),
});

function renderFailure(props: StartupFailureProps) {
	return render(<StartupFailure {...props} />);
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe("APP-08 StartupScreen", () => {
	it("shows the sidecar phase under the one status region", () => {
		render(<StartupScreen phase="sidecar" />);

		const status = screen.getByRole("status", { name: "Starting Conducted" });
		expect(within(status).getByText("Starting Conducted")).toBeTruthy();
		expect(within(status).getByText("Starting agents")).toBeTruthy();
	});

	it("names every phase in plain words", () => {
		const { rerender } = render(<StartupScreen phase="database" />);
		expect(screen.getByText("Opening the database")).toBeTruthy();
		rerender(<StartupScreen phase="settings" />);
		expect(screen.getByText("Loading settings")).toBeTruthy();
		rerender(<StartupScreen phase="services" />);
		expect(screen.getByText("Starting services")).toBeTruthy();
	});
});

describe("APP-08 StartupFailure", () => {
	it("shows the database blocker and checks for updates once", () => {
		const props = callbacks();
		renderFailure({
			...props,
			blocker: {
				kind: "blocked",
				reason: "database_newer_than_app",
				databaseVersion: "12",
				appVersion: "11",
			},
		});

		expect(screen.getByRole("heading", { name: "Database from a newer version" })).toBeTruthy();
		expect(screen.getByText(/schema version 12/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Update" }));
		expect(props.onUpdate).toHaveBeenCalledTimes(1);
	});

	it("shows a failed start with its message, log path, diagnostics and Retry", () => {
		const props = callbacks();
		renderFailure({
			...props,
			blocker: {
				kind: "failed",
				phase: "sidecar",
				message: "The sidecar did not answer",
				logPath: "/Users/me/Library/Logs/Conducted/sidecar.log",
			},
		});

		expect(screen.getByRole("heading", { name: "Failed to start agents" })).toBeTruthy();
		expect(screen.getByText("The sidecar did not answer")).toBeTruthy();
		expect(screen.getByText("/Users/me/Library/Logs/Conducted/sidecar.log")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy diagnostics" }));
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(props.onCopyDiagnostics).toHaveBeenCalledTimes(1);
		expect(props.onRetry).toHaveBeenCalledTimes(1);
	});

	it("shows the wrong CPU full screen and continues through the confirm", async () => {
		const test = createTestContainer();
		try {
			const props = callbacks();
			const onContinueAnyway = vi.fn();
			render(
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>
						<StartupFailure
							{...props}
							blocker={{
								kind: "wrong_cpu_build",
								system: { osVersion: "15.0", machineArch: "arm64", buildArch: "x86_64" },
							}}
							onContinueAnyway={onContinueAnyway}
						/>
					</AppProviders>
				</ServicesProvider>,
			);

			expect(
				screen.getByRole("heading", { name: "Wrong version of Conducted for this Mac" }),
			).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Continue anyway" }));
			const dialogButtons = await screen.findAllByRole("button", { name: "Continue anyway" });
			fireEvent.click(dialogButtons[dialogButtons.length - 1] as HTMLElement);
			expect(onContinueAnyway).toHaveBeenCalledTimes(1);
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});

describe("APP-08 app entry", () => {
	it("mounts the blocked database screen from the real start-up", async () => {
		const test = openTestDatabase();
		const memory = createMemoryPlatform({
			clock: { now: () => 1_000 },
			ids: { uuid: () => crypto.randomUUID() },
			database: test.database,
			version: "0.1.0-test",
		});
		vi.spyOn(memory.platform.app, "dbVersionWarning").mockResolvedValue(
			ok({ databaseVersion: 12, appVersion: 11 }),
		);
		const root = document.createElement("div");
		document.body.appendChild(root);
		const app: StartedApp = startApp({ root, platform: memory.platform, installHandlers: false });
		await app.started;

		expect(
			await screen.findByRole("heading", { name: "Database from a newer version" }),
		).toBeTruthy();

		vi.spyOn(app.container.services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
		vi.spyOn(app.container.sidecar, "stop").mockImplementation(() => {});
		await app.container.stop();
		app.unmount();
		root.remove();
		test.close();
	});
});
