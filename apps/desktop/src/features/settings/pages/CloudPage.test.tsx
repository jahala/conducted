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
	it("offers Deploy and Pair on an unpaired Mac, without sending it to Connections", async () => {
		await mountPage(null);
		expect(await screen.findByText("Not paired")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Deploy to Cloudflare" })).toBeTruthy();
		expect(screen.getByLabelText("Worker URL")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Pair" })).toBeTruthy();
		expect(screen.queryByText(/Connections page/)).toBeNull();
	});

	it("pairs with a Worker URL and a token, then unpairs", async () => {
		const test = await mountPage(null);
		fireEvent.change(screen.getByLabelText("Worker URL"), {
			target: { value: "https://conducted.example.workers.dev/" },
		});
		fireEvent.change(screen.getByLabelText("Pairing token"), {
			target: { value: "32-random-bytes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair" }));

		expect(
			await screen.findByText("Paired with https://conducted.example.workers.dev."),
		).toBeTruthy();
		expect((await test.container.platform.cloud.status()).ok).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Unpair" }));
		expect(await screen.findByText("Not paired")).toBeTruthy();
	});

	it("shows why a Worker URL was refused and does not pair", async () => {
		const test = await mountPage(null);
		fireEvent.change(screen.getByLabelText("Worker URL"), {
			target: { value: "http://conducted.example.workers.dev" },
		});
		fireEvent.change(screen.getByLabelText("Pairing token"), {
			target: { value: "32-random-bytes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair" }));

		expect(await screen.findByText("A Worker URL must be https and name a host.")).toBeTruthy();
		const status = await test.container.platform.cloud.status();
		expect(status.ok && status.value.paired).toBe(false);
	});

	it("deploys the app's Worker and pairs this Mac", async () => {
		const test = await mountPage(null);
		fireEvent.click(screen.getByRole("button", { name: "Deploy to Cloudflare" }));

		expect(
			await screen.findByText("Paired with https://conducted-cloud.example.workers.dev."),
		).toBeTruthy();
		expect(test.memory.controls.cloudDeploys).toEqual([{}]);
		expect((await test.container.platform.cloud.status()).ok).toBe(true);
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
			await screen.findByText("Conducted could not connect to cloud settings. Try again."),
		).toBeTruthy();
	});
});
