/**
 * @feature CLOUD-17 Cloud settings page
 * Tests the Cloud page: the unpaired state, the saved variables, adding a variable the Worker
 * refuses, and the page's own message when the Worker cannot be reached.
 * Test first: a refused name keeps the add panel open and shows the Worker's reason.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { Toaster } from "../../../ui/Toast.tsx";
import { CloudPage } from "./CloudPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

/** Renders the page with a Worker that answers from `settings`. */
async function mountPage(settings: { current: unknown } | null) {
	test = createTestContainer();
	if (settings !== null) {
		test.memory.controls.setCloudPairing({ paired: true, url: "https://w.example.dev" });
		test.memory.controls.scriptCloud((request) => {
			if (request.path !== "/settings") return null;
			if (request.method === "GET") {
				return ok({ status: 200, body: JSON.stringify(settings.current) });
			}
			settings.current = request.body;
			return ok({ status: 200, body: JSON.stringify(settings.current) });
		});
	} else {
		test.memory.controls.setCloudPairing({ paired: false, url: null });
	}
	await test.container.services.settings.start();
	await test.container.services.cloudPairing.start();
	render(
		<ServicesProvider container={test.container}>
			<CloudPage />
		</ServicesProvider>,
	);
	return test;
}

describe("CLOUD-17 CloudPage", () => {
	it("says how to pair a Mac that has no Worker", async () => {
		await mountPage(null);
		expect(await screen.findByText("No Worker is paired")).toBeTruthy();
		expect(screen.getByText(/Connections page/)).toBeTruthy();
	});

	it("lists the Worker's personal variables and saves a new one", async () => {
		const settings = {
			current: { gitIdentity: null, envVars: { NODE_ENV: "development" } },
		};
		await mountPage(settings);
		expect(await screen.findByText("NODE_ENV")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Add environment variable" }));
		fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "API_URL" } });
		fireEvent.change(screen.getByLabelText("Value"), {
			target: { value: "https://api.example.com" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Save/ }));

		await waitFor(() =>
			expect(settings.current).toEqual({
				gitIdentity: null,
				envVars: { NODE_ENV: "development", API_URL: "https://api.example.com" },
			}),
		);
		expect(await screen.findByText("API_URL")).toBeTruthy();
	});

	it("keeps the panel open and shows the Worker's reason for a refused name", async () => {
		const settings = { current: { gitIdentity: null, envVars: {} } };
		test = createTestContainer();
		test.memory.controls.setCloudPairing({ paired: true, url: "https://w.example.dev" });
		test.memory.controls.scriptCloud((request) => {
			if (request.path !== "/settings") return null;
			if (request.method === "GET") {
				return ok({ status: 200, body: JSON.stringify(settings.current) });
			}
			return ok({
				status: 400,
				body: JSON.stringify({
					error: "PATH is set by the sandbox and cannot be changed here.",
				}),
			});
		});
		await test.container.services.settings.start();
		await test.container.services.cloudPairing.start();
		render(
			<ServicesProvider container={test.container}>
				<CloudPage />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Add environment variable" }));
		fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "PATH" } });
		fireEvent.change(screen.getByLabelText("Value"), { target: { value: "/tmp" } });
		fireEvent.click(screen.getByRole("button", { name: /Save/ }));

		expect(
			await screen.findByText("PATH is set by the sandbox and cannot be changed here."),
		).toBeTruthy();
		expect(screen.getByLabelText("Name")).toBeTruthy();
	});

	it("shows the page's own message when the Worker cannot be reached", async () => {
		test = createTestContainer();
		test.memory.controls.setCloudPairing({ paired: true, url: "https://w.example.dev" });
		test.memory.controls.scriptCloud((request) =>
			request.path === "/settings"
				? ok({ status: 500, body: JSON.stringify({ error: "down" }) })
				: null,
		);
		await test.container.services.settings.start();
		await test.container.services.cloudPairing.start();
		render(
			<ServicesProvider container={test.container}>
				<CloudPage />
			</ServicesProvider>,
		);

		expect(
			await screen.findByText("Conductor could not connect to cloud settings. Try again."),
		).toBeTruthy();
	});
});
