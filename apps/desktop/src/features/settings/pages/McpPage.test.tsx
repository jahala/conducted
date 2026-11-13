/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the MCP page's saves and its import through the test container, with a Worker that
 * answers from a settings object the test holds. These moved here from CloudPage.test.tsx when the
 * MCP servers got their own page, as Conductor's have (CLOUD-17).
 * Test first: adds a bearer-token MCP server and never shows its token again.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { Toaster } from "../../../ui/Toast.tsx";
import { McpPage } from "./McpPage.tsx";

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
			<McpPage />
		</ServicesProvider>,
	);
	return test;
}

interface ImportSettings {
	gitIdentity: null;
	envVars: Record<string, string>;
	mcpServers: Record<string, unknown>;
}

/** Renders the page with two remote servers in Cursor's local config, its import dialog open. */
async function mountImport(settings: { current: ImportSettings }): Promise<TestContainer> {
	const mounted = createTestContainer();
	test = mounted;
	mounted.memory.controls.setCloudPairing({ paired: true, url: "https://w.example.dev" });
	mounted.memory.controls.files.set(
		`${mounted.memory.platform.fs.paths.home}/.cursor/mcp.json`,
		JSON.stringify({
			mcpServers: {
				alpha: { url: "https://alpha.example.com/mcp" },
				beta: { url: "https://beta.example.com/mcp" },
			},
		}),
	);
	mounted.memory.controls.scriptCloud((request) => {
		if (request.path !== "/settings") return null;
		if (request.method === "GET") {
			return ok({ status: 200, body: JSON.stringify(settings.current) });
		}
		settings.current = request.body as ImportSettings;
		return ok({ status: 200, body: JSON.stringify(settings.current) });
	});
	await mounted.container.services.settings.start();
	await mounted.container.services.cloudPairing.start();
	render(
		<ServicesProvider container={mounted.container}>
			<McpPage />
			<Toaster />
		</ServicesProvider>,
	);
	fireEvent.mouseDown(await screen.findByRole("tab", { name: "Recommended" }), { button: 0 });
	fireEvent.click(await screen.findByRole("button", { name: "Import from local" }));
	return mounted;
}

describe("CLOUD-17 McpPage", () => {
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
		expect(await screen.findByRole("group", { name: "Linear MCP server" })).toBeTruthy();
		// Conductor's row shows the name only: no authentication label, and never the token.
		expect(screen.queryByText("Bearer token")).toBeNull();
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
				<McpPage />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.mouseDown(await screen.findByRole("tab", { name: "Recommended" }), { button: 0 });
		fireEvent.click(await screen.findByRole("button", { name: "Import from local" }));
		// Conductor's sheet chooses every local server at first.
		expect(
			(await screen.findByRole("checkbox", { name: "localServer" })).getAttribute("aria-checked"),
		).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "Add 1 MCP server" }));

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

	it("filters local servers by name, URL and source, and says when none match", async () => {
		await mountImport({ current: { gitIdentity: null, envVars: {}, mcpServers: {} } });
		expect(await screen.findByRole("checkbox", { name: "alpha" })).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "beta" })).toBeTruthy();

		const search = screen.getByPlaceholderText("Search MCP servers...");
		fireEvent.change(search, { target: { value: "alp" } });
		expect(screen.getByRole("checkbox", { name: "alpha" })).toBeTruthy();
		expect(screen.queryByRole("checkbox", { name: "beta" })).toBeNull();

		fireEvent.change(search, { target: { value: "beta.example" } });
		expect(screen.queryByRole("checkbox", { name: "alpha" })).toBeNull();
		expect(screen.getByRole("checkbox", { name: "beta" })).toBeTruthy();

		fireEvent.change(search, { target: { value: "cursor" } });
		expect(screen.getByRole("checkbox", { name: "alpha" })).toBeTruthy();
		expect(screen.getByRole("checkbox", { name: "beta" })).toBeTruthy();

		fireEvent.change(search, { target: { value: "nothing" } });
		expect(await screen.findByText("No matching MCP servers.")).toBeTruthy();
		expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
	});

	it("selects all listed servers with one click and clears them", async () => {
		const settings: { current: ImportSettings } = {
			current: { gitIdentity: null, envVars: {}, mcpServers: {} },
		};
		await mountImport(settings);
		const checked = (name: string) =>
			screen.getByRole("checkbox", { name }).getAttribute("aria-checked");
		// Conductor's sheet opens with every server chosen.
		expect(await screen.findByRole("button", { name: "Deselect all" })).toBeTruthy();
		expect(checked("alpha")).toBe("true");
		expect(checked("beta")).toBe("true");

		fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
		expect(checked("alpha")).toBe("false");
		expect(checked("beta")).toBe("false");
		expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Select all" }));
		expect(checked("alpha")).toBe("true");
		expect(checked("beta")).toBe("true");
		expect(screen.getByRole("button", { name: "Deselect all" })).toBeTruthy();

		// The toggle acts on what the search leaves, as Conductor's does.
		fireEvent.change(screen.getByPlaceholderText("Search MCP servers..."), {
			target: { value: "alp" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
		fireEvent.click(screen.getByRole("button", { name: "Add 1 MCP server" }));
		await waitFor(() => expect(Object.keys(settings.current.mcpServers)).toEqual(["beta"]));
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

		fireEvent.keyDown(await screen.findByRole("button", { name: "Linear actions" }), {
			key: "Enter",
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
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
