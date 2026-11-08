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
			current: { gitIdentity: null, envVars: { NODE_ENV: "development" }, mcpServers: {} },
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
				mcpServers: {},
			}),
		);
		expect(await screen.findByText("API_URL")).toBeTruthy();
	});

	it("keeps the panel open and shows the Worker's reason for a refused name", async () => {
		const settings = { current: { gitIdentity: null, envVars: {}, mcpServers: {} } };
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

	it("adds a bearer-token MCP server and never shows its token again", async () => {
		const settings = { current: { gitIdentity: null, envVars: {}, mcpServers: {} } };
		await mountPage(settings);

		fireEvent.click(await screen.findByRole("button", { name: "Add MCP server" }));
		fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "linear" } });
		fireEvent.change(screen.getByLabelText("URL"), {
			target: { value: "https://mcp.linear.app/mcp" },
		});
		fireEvent.keyDown(screen.getByLabelText("Authentication"), { key: "Enter" });
		fireEvent.click(await screen.findByRole("option", { name: "Bearer token" }));
		fireEvent.change(await screen.findByLabelText("Token"), { target: { value: "lin_api_x" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(settings.current).toEqual({
				gitIdentity: null,
				envVars: {},
				mcpServers: {
					linear: {
						url: "https://mcp.linear.app/mcp",
						authType: "bearer",
						bearerToken: "lin_api_x",
					},
				},
			}),
		);
		expect(await screen.findByText("linear")).toBeTruthy();
		expect(screen.getByText("Bearer token configured")).toBeTruthy();
		expect(screen.queryByText("lin_api_x")).toBeNull();
	});

	it("imports a remote server from a local agent config in one save", async () => {
		const settings = { current: { gitIdentity: null, envVars: {}, mcpServers: {} } };
		test = createTestContainer();
		test.memory.controls.setCloudPairing({ paired: true, url: "https://w.example.dev" });
		test.memory.controls.files.set(
			`${test.memory.platform.fs.paths.home}/.cursor/mcp.json`,
			JSON.stringify({
				mcpServers: {
					localServer: {
						url: "https://mcp.example.com/mcp",
						headers: { "X-Api-Key": "local-secret" },
					},
				},
			}),
		);
		test.memory.controls.scriptCloud((request) => {
			if (request.path !== "/settings") return null;
			if (request.method === "GET") {
				return ok({ status: 200, body: JSON.stringify(settings.current) });
			}
			settings.current = request.body as typeof settings.current;
			return ok({ status: 200, body: JSON.stringify(settings.current) });
		});
		await test.container.services.settings.start();
		await test.container.services.cloudPairing.start();
		render(
			<ServicesProvider container={test.container}>
				<CloudPage />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Import from local" }));
		fireEvent.click(await screen.findByRole("checkbox", { name: "Import localServer" }));
		fireEvent.click(screen.getByRole("button", { name: "Import" }));

		await waitFor(() =>
			expect(settings.current.mcpServers).toEqual({
				localServer: {
					url: "https://mcp.example.com/mcp",
					authType: "headers",
					headers: { "X-Api-Key": "local-secret" },
				},
			}),
		);
		const posts = test.memory.controls.cloudRequests.filter(
			(request) => request.method === "POST" && request.path === "/settings",
		);
		expect(posts).toHaveLength(1);
	});

	it("keeps a saved bearer token when an edit leaves the token field blank", async () => {
		const settings = {
			current: {
				gitIdentity: null,
				envVars: {},
				mcpServers: {
					linear: {
						url: "https://mcp.linear.app/mcp",
						authType: "bearer",
						bearerToken: "lin_api_x",
					},
				},
			},
		};
		await mountPage(settings);

		fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
		fireEvent.change(await screen.findByLabelText("URL"), {
			target: { value: "https://mcp.linear.app/v2/mcp" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(settings.current).toEqual({
				gitIdentity: null,
				envVars: {},
				mcpServers: {
					linear: {
						url: "https://mcp.linear.app/v2/mcp",
						authType: "bearer",
						bearerToken: "lin_api_x",
					},
				},
			}),
		);
	});
});
