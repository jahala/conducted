/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the Cloud page's MCP section in Conductor's words and layout (renderApp, read 2026-11-12):
 * the "MCP" heading, the Installed and Recommended tabs, the installed list's rows and actions menu,
 * the add dialog's fields and placeholders, and the "Select MCP servers" import dialog.
 * Each test runs the real Cloud page through the test container, with a Worker that answers from
 * a settings object the test holds.
 * Test first: draws each server as a row with its name and an actions menu holding Edit and Delete.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { Toaster } from "../../../ui/Toast.tsx";
import { CloudPage } from "../pages/CloudPage.tsx";

interface Settings {
	gitIdentity: null;
	envVars: Record<string, string>;
	mcpServers: Record<string, unknown>;
}

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

/** Renders the Cloud page paired with a Worker that answers from `settings`, and `files` on disk. */
async function mount(
	settings: { current: Settings },
	files: Readonly<Record<string, unknown>> = {},
): Promise<TestContainer> {
	const mounted = createTestContainer();
	test = mounted;
	mounted.memory.controls.setCloudPairing({ paired: true, url: "https://w.example.dev" });
	for (const [path, value] of Object.entries(files)) {
		mounted.memory.controls.files.set(
			`${mounted.memory.platform.fs.paths.home}/${path}`,
			JSON.stringify(value),
		);
	}
	mounted.memory.controls.scriptCloud((request) => {
		if (request.path !== "/settings") return null;
		if (request.method === "GET") {
			return ok({ status: 200, body: JSON.stringify(settings.current) });
		}
		settings.current = request.body as Settings;
		return ok({ status: 200, body: JSON.stringify(settings.current) });
	});
	await mounted.container.services.settings.start();
	await mounted.container.services.cloudPairing.start();
	render(
		<ServicesProvider container={mounted.container}>
			<CloudPage />
			<Toaster />
		</ServicesProvider>,
	);
	return mounted;
}

const empty = (): { current: Settings } => ({
	current: { gitIdentity: null, envVars: {}, mcpServers: {} },
});

const twoInCursor = {
	".cursor/mcp.json": {
		mcpServers: {
			alpha: { url: "https://alpha.example.com/mcp" },
			beta: { url: "https://beta.example.com/mcp" },
		},
	},
};

async function openTab(name: "Installed" | "Recommended") {
	fireEvent.mouseDown(await screen.findByRole("tab", { name }), { button: 0 });
}

async function openImport() {
	await openTab("Recommended");
	fireEvent.click(await screen.findByRole("button", { name: "Import from local" }));
	return screen.findByRole("dialog", { name: "Select MCP servers" });
}

describe("CLOUD-17 the MCP section, as Conductor's MCP page", () => {
	it("titles the section MCP and opens on the Installed tab with its search and empty line", async () => {
		await mount(empty());
		expect(await screen.findByRole("heading", { name: "MCP" })).toBeTruthy();
		expect(screen.getByText("Configure MCP servers for cloud workspaces.")).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Installed" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByRole("tab", { name: "Recommended" })).toBeTruthy();
		expect(screen.getByPlaceholderText("Search installed MCPs")).toBeTruthy();
		expect(screen.getByText("No MCP servers installed")).toBeTruthy();
		expect(screen.queryByText("No MCP servers configured.")).toBeNull();
		expect(screen.queryByText("MCP servers")).toBeNull();
	});

	it("filters installed servers by name or URL and says when none match", async () => {
		const settings = empty();
		settings.current.mcpServers = {
			linear: { url: "https://mcp.linear.app/mcp", authType: "none" },
			sentry: { url: "https://mcp.sentry.dev/mcp", authType: "none" },
		};
		await mount(settings);
		const search = await screen.findByPlaceholderText("Search installed MCPs");
		fireEvent.change(search, { target: { value: "sentry.dev" } });
		expect(screen.getByRole("group", { name: "Sentry MCP server" })).toBeTruthy();
		expect(screen.queryByRole("group", { name: "Linear MCP server" })).toBeNull();
		fireEvent.change(search, { target: { value: "nothing" } });
		expect(screen.getByText("No installed MCPs match your search")).toBeTruthy();
	});

	it("draws each server as a row with its name and an actions menu holding Edit and Delete", async () => {
		const settings = empty();
		settings.current.mcpServers = {
			linear: { url: "https://mcp.linear.app/mcp", authType: "bearer", bearerToken: "lin_x" },
		};
		await mount(settings);
		const row = await screen.findByRole("group", { name: "Linear MCP server" });
		// Conductor's row shows the name only: no URL, no authentication badge, no buttons.
		expect(within(row).queryByText("https://mcp.linear.app/mcp")).toBeNull();
		expect(within(row).queryByText("Bearer token")).toBeNull();
		expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

		fireEvent.keyDown(within(row).getByRole("button", { name: "Linear actions" }), {
			key: "Enter",
		});
		expect(await screen.findByRole("menuitem", { name: "Edit" })).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
		await waitFor(() => expect(settings.current.mcpServers).toEqual({}));
		expect(await screen.findByText("No MCP servers installed")).toBeTruthy();
	});

	it("adds through Conductor's dialog: its auth choices in order, its placeholders, no note of ours", async () => {
		await mount(empty());
		fireEvent.click(await screen.findByRole("button", { name: "Add MCP server" }));
		const dialog = await screen.findByRole("dialog", { name: "Add MCP server" });
		expect(within(dialog).queryByText(/The credential is kept in your Worker/)).toBeNull();

		fireEvent.keyDown(within(dialog).getByLabelText("Authentication"), { key: "Enter" });
		const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
		expect(options).toEqual(["Bearer token", "Custom headers", "None"]);
		fireEvent.click(screen.getByRole("option", { name: "Bearer token" }));

		const token = await within(dialog).findByLabelText("Token");
		expect(token.getAttribute("placeholder")).toBe("Paste token");
		expect(token.getAttribute("type")).not.toBe("password");
		fireEvent.change(token, { target: { value: "tok_1" } });

		// Switching to Custom headers carries the token over as an Authorization header.
		fireEvent.keyDown(within(dialog).getByLabelText("Authentication"), { key: "Enter" });
		fireEvent.click(await screen.findByRole("option", { name: "Custom headers" }));
		const headers = await within(dialog).findByLabelText("Headers");
		expect(headers.getAttribute("placeholder")).toBe("X-Api-Key: value\nOne header per line");
		expect((headers as HTMLTextAreaElement).value).toBe("Authorization: Bearer tok_1");
	});

	it("says Conductor's words for an empty URL and a reserved name, and saves empty headers as none", async () => {
		const settings = empty();
		await mount(settings);
		fireEvent.click(await screen.findByRole("button", { name: "Add MCP server" }));
		const dialog = await screen.findByRole("dialog", { name: "Add MCP server" });
		fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "conducted" } });
		fireEvent.click(within(dialog).getByRole("button", { name: /Save/ }));
		expect(
			await within(dialog).findByText(
				'Names can be 1-64 letters, numbers, hyphens, or underscores — no spaces ("conducted" names are reserved)',
			),
		).toBeTruthy();

		fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "docs" } });
		fireEvent.click(within(dialog).getByRole("button", { name: /Save/ }));
		expect(await within(dialog).findByText("Enter a server URL")).toBeTruthy();

		fireEvent.change(within(dialog).getByLabelText("URL"), {
			target: { value: "https://docs.example.com/mcp" },
		});
		fireEvent.keyDown(within(dialog).getByLabelText("Authentication"), { key: "Enter" });
		fireEvent.click(await screen.findByRole("option", { name: "Custom headers" }));
		fireEvent.click(within(dialog).getByRole("button", { name: /Save/ }));
		await waitFor(() =>
			expect(settings.current.mcpServers).toEqual({
				docs: { url: "https://docs.example.com/mcp", authType: "none" },
			}),
		);
	});

	it("keeps Import from local on the Recommended tab, behind its own search", async () => {
		await mount(empty());
		await openTab("Recommended");
		const search = await screen.findByPlaceholderText("Search recommended MCPs");
		expect(screen.getByRole("button", { name: "Import from local" })).toBeTruthy();
		fireEvent.change(search, { target: { value: "cursor" } });
		expect(screen.getByRole("button", { name: "Import from local" })).toBeTruthy();
		fireEvent.change(search, { target: { value: "notion" } });
		expect(screen.queryByRole("button", { name: "Import from local" })).toBeNull();
		expect(screen.getByText("No recommended MCPs match your search")).toBeTruthy();
	});

	it("chooses every local server at first, lists each with its sources and URL, and offers Deselect all", async () => {
		await mount(empty(), twoInCursor);
		const dialog = await openImport();
		const alpha = await within(dialog).findByRole("checkbox", { name: "alpha" });
		expect(alpha.getAttribute("aria-checked")).toBe("true");
		expect(within(dialog).getByText("Cursor · https://alpha.example.com/mcp")).toBeTruthy();
		expect(within(dialog).queryByText(/found in this Mac's agent configs/)).toBeNull();
		expect(within(dialog).getByRole("button", { name: "Add 2 MCP servers" })).toBeTruthy();

		fireEvent.click(within(dialog).getByRole("button", { name: "Deselect all" }));
		expect(alpha.getAttribute("aria-checked")).toBe("false");
		expect(within(dialog).getByRole("button", { name: "Select all" })).toBeTruthy();
		expect(
			(within(dialog).getByRole("button", { name: "Add MCP servers" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("says Conductor's words while scanning and when no local server is found", async () => {
		await mount(empty());
		await openTab("Recommended");
		fireEvent.click(await screen.findByRole("button", { name: "Import from local" }));
		// The scan is still running in the same tick as the click.
		expect(screen.getByRole("status", { name: "Scanning local MCP servers" })).toBeTruthy();
		const dialog = await screen.findByRole("dialog", { name: "Select MCP servers" });
		expect(await within(dialog).findByText("No local MCP servers found")).toBeTruthy();
		expect(within(dialog).queryByText("All local MCP servers are already added")).toBeNull();
	});
});
