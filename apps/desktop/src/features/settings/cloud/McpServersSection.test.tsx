/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the MCP page in Conductor's words and layout (renderApp, read 2026-11-12 and 2026-11-13):
 * the "MCP" title, the Installed and Recommended tabs, the installed list's rows and actions menu,
 * the add dialog's fields and placeholders, an OAuth server's status, sign-in and Disconnect, the
 * Recommended catalogue and its setup dialogs, the re-auth notice, and the "Select MCP servers"
 * import dialog. Each test runs the real page through the test container, with a Worker that
 * answers from a settings object and an OAuth state the test holds.
 * Test first: a new server starts on OAuth, and saving it opens the provider's sign-in.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { Toaster } from "../../../ui/Toast.tsx";
import { McpPage } from "../pages/McpPage.tsx";

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
		if (request.path.startsWith("/mcp-oauth")) return worker.answer(request);
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
			<McpPage />
			<Toaster />
		</ServicesProvider>,
	);
	return mounted;
}

/**
 * The Worker's OAuth side, as apps/cloud's mcp-oauth-routes.ts answers it: the credentials, a
 * connect's URL and state, its status, a cancel and a disconnect. Each call is recorded.
 */
class OAuthWorker {
	credentials: Record<string, { status: "active" | "needs_reauth"; statusDetail?: string }> = {};
	/** What the next status check answers; `absent` with `connectOnAbsent` is a finished sign-in. */
	status: "pending" | "failed" | "absent" = "absent";
	connectOnAbsent = true;
	calls: string[] = [];

	answer(request: { method: string; path: string; body?: unknown }) {
		this.calls.push(`${request.method} ${request.path}`);
		const reply = (body: unknown) => ok({ status: 200, body: JSON.stringify(body) });
		if (request.path === "/mcp-oauth") {
			return reply({
				callbackUrl: "https://w.example.dev/mcp-oauth/callback",
				servers: this.credentials,
			});
		}
		const match = /^\/mcp-oauth\/([^/]+)\/(connect|status|cancel|disconnect)/.exec(request.path);
		if (match === null) return null;
		const [, name = "", action] = match;
		if (action === "connect") {
			return reply({
				authorizationUrl: `https://auth.example/authorize?for=${name}`,
				state: "st-1",
			});
		}
		if (action === "status") {
			if (this.status === "absent" && this.connectOnAbsent)
				this.credentials[name] = { status: "active" };
			return reply({ status: this.status });
		}
		if (action === "cancel") return reply({ cancelled: true });
		delete this.credentials[name];
		return reply({});
	}
}

let worker = new OAuthWorker();

afterEach(() => {
	worker = new OAuthWorker();
});

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

describe("CLOUD-17 the MCP page, as Conductor's", () => {
	it("titles the page MCP and opens on the Installed tab with its search and empty line", async () => {
		await mount(empty());
		expect(await screen.findByRole("heading", { name: "MCP" })).toBeTruthy();
		// Conductor's page header is the title alone (`NHe`).
		expect(screen.queryByText("Configure MCP servers for cloud workspaces.")).toBeNull();
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
		expect(options).toEqual(["OAuth", "Bearer token", "Custom headers", "None"]);
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
		expect(screen.getByRole("button", { name: "Notion" })).toBeTruthy();
		fireEvent.change(search, { target: { value: "nothing like it" } });
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

	it("starts a new server on OAuth, and saving it opens the provider's sign-in", async () => {
		const settings = empty();
		const mounted = await mount(settings);
		const opened = vi.spyOn(mounted.container.platform.opener, "openUrl").mockResolvedValue();
		fireEvent.click(await screen.findByRole("button", { name: "Add MCP server" }));
		const dialog = await screen.findByRole("dialog", { name: "Add MCP server" });
		expect(within(dialog).getByLabelText("Authentication").textContent).toContain("OAuth");
		fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "notion" } });
		fireEvent.change(within(dialog).getByLabelText("URL"), {
			target: { value: "https://mcp.notion.com/mcp" },
		});
		worker.status = "pending";
		fireEvent.click(within(dialog).getByRole("button", { name: /Save/ }));
		await waitFor(() =>
			expect(settings.current.mcpServers).toEqual({
				notion: { url: "https://mcp.notion.com/mcp", authType: "oauth" },
			}),
		);
		await waitFor(() =>
			expect(opened).toHaveBeenCalledWith("https://auth.example/authorize?for=notion"),
		);
		const row = await screen.findByRole("group", { name: "Notion MCP server" });
		expect(within(row).getByText("Connecting…")).toBeTruthy();
		expect(within(row).getByRole("button", { name: "Stop waiting" })).toBeTruthy();
		expect(row.querySelector('[data-mark="notion"]')).not.toBeNull();
	});

	it("shows a connected OAuth server, and asks before it disconnects", async () => {
		const settings = empty();
		settings.current.mcpServers = {
			linear: { url: "https://mcp.linear.app/mcp", authType: "oauth" },
		};
		worker.credentials = { linear: { status: "active" } };
		await mount(settings);
		const row = await screen.findByRole("group", { name: "Linear MCP server" });
		expect(await within(row).findByText("Connected")).toBeTruthy();
		expect(within(row).queryByRole("button", { name: "Authenticate" })).toBeNull();
		fireEvent.click(within(row).getByRole("button", { name: "Disconnect" }));
		const confirm = await screen.findByRole("alertdialog", { name: "Disconnect linear?" });
		fireEvent.click(within(confirm).getByRole("button", { name: "Disconnect" }));
		expect(await within(row).findByText("Disconnected")).toBeTruthy();
		expect(within(row).getByRole("button", { name: "Authenticate" })).toBeTruthy();
		expect(worker.calls).toContain("POST /mcp-oauth/linear/disconnect");
	});

	it("says Needs re-auth, connects again, and shows Connected once the Worker holds the tokens", async () => {
		const settings = empty();
		settings.current.mcpServers = {
			sentry: { url: "https://mcp.sentry.dev/mcp", authType: "oauth" },
		};
		worker.credentials = {
			sentry: { status: "needs_reauth", statusDetail: "The refresh token is not valid." },
		};
		const mounted = await mount(settings);
		const opened = vi.spyOn(mounted.container.platform.opener, "openUrl").mockResolvedValue();
		const row = await screen.findByRole("group", { name: "Sentry MCP server" });
		expect(await within(row).findByText("Needs re-auth")).toBeTruthy();
		fireEvent.click(within(row).getByRole("button", { name: "Re-authenticate" }));
		expect(await within(row).findByText("Connected")).toBeTruthy();
		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("toasts Conductor's words when the sign-in fails", async () => {
		const settings = empty();
		settings.current.mcpServers = {
			linear: { url: "https://mcp.linear.app/mcp", authType: "oauth" },
		};
		const mounted = await mount(settings);
		vi.spyOn(mounted.container.platform.opener, "openUrl").mockResolvedValue();
		worker.status = "failed";
		const row = await screen.findByRole("group", { name: "Linear MCP server" });
		fireEvent.click(await within(row).findByRole("button", { name: "Authenticate" }));
		expect(await screen.findByText("Couldn't connect this MCP server")).toBeTruthy();
		expect(
			screen.getByText("Authorization failed. Try connecting the MCP server again."),
		).toBeTruthy();
		expect(await within(row).findByText("Disconnected")).toBeTruthy();
	});

	it("reopens a saved bearer server as Custom headers, keeping its token until new headers replace it", async () => {
		const settings = empty();
		settings.current.mcpServers = {
			linear: { url: "https://mcp.linear.app/mcp", authType: "bearer", bearerToken: "lin_x" },
		};
		await mount(settings);
		const row = await screen.findByRole("group", { name: "Linear MCP server" });
		fireEvent.keyDown(within(row).getByRole("button", { name: "Linear actions" }), {
			key: "Enter",
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
		const dialog = await screen.findByRole("dialog", { name: "Edit MCP server" });
		expect(within(dialog).getByLabelText("Authentication").textContent).toContain("Custom headers");
		const headers = within(dialog).getByLabelText("Headers");
		expect(headers.getAttribute("placeholder")).toBe(
			"Credential configured — enter headers to replace",
		);
		expect((headers as HTMLTextAreaElement).value).toBe("");
		fireEvent.change(within(dialog).getByLabelText("URL"), {
			target: { value: "https://mcp.linear.app/v2/mcp" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: /Save/ }));
		await waitFor(() =>
			expect(settings.current.mcpServers).toEqual({
				linear: { url: "https://mcp.linear.app/v2/mcp", authType: "bearer", bearerToken: "lin_x" },
			}),
		);
	});

	it("keeps the OAuth callback URL and the client under Advanced client identity", async () => {
		const settings = empty();
		await mount(settings);
		fireEvent.click(await screen.findByRole("button", { name: "Add MCP server" }));
		const dialog = await screen.findByRole("dialog", { name: "Add MCP server" });
		expect(within(dialog).queryByLabelText("Client ID")).toBeNull();
		fireEvent.click(within(dialog).getByRole("button", { name: "Advanced client identity" }));
		expect(
			await within(dialog).findByText("https://w.example.dev/mcp-oauth/callback"),
		).toBeTruthy();
		expect(within(dialog).getByRole("button", { name: "Copy OAuth callback URL" })).toBeTruthy();
		expect(within(dialog).getByLabelText("Client secret").getAttribute("type")).toBe("password");
		fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "own" } });
		fireEvent.change(within(dialog).getByLabelText("URL"), {
			target: { value: "https://mcp.own.example/mcp" },
		});
		fireEvent.change(within(dialog).getByLabelText("Client secret"), { target: { value: "s" } });
		fireEvent.click(within(dialog).getByRole("button", { name: /Save/ }));
		expect(await within(dialog).findByText("Enter a client ID")).toBeTruthy();
		expect(settings.current.mcpServers).toEqual({});
	});

	it("lists Conductor's recommended servers in its order, after Import from local", async () => {
		await mount(empty());
		await openTab("Recommended");
		const panel = await screen.findByRole("tabpanel");
		const cards = within(panel)
			.getAllByRole("button")
			.map((button) => button.getAttribute("aria-label") ?? button.textContent);
		expect(cards).toEqual([
			"Import from local",
			"Granola",
			"Notion",
			"Airtable",
			"Linear",
			"Asana",
			"PostHog",
			"Amplitude",
			"Hex",
			"Sentry",
			"Datadog",
			"Slack",
			"Composio",
			"Stripe",
			"Supabase",
			"Vercel",
			"Cloudflare",
			"Neon",
			"PlanetScale",
			"Snowflake",
			"Atlassian",
			"Honeycomb",
			"Context7",
			"Firecrawl",
			"Exa",
		]);
	});

	it("adds a recommended server in one click, connects it, and marks it installed", async () => {
		const settings = empty();
		const mounted = await mount(settings);
		const opened = vi.spyOn(mounted.container.platform.opener, "openUrl").mockResolvedValue();
		await openTab("Recommended");
		fireEvent.click(await screen.findByRole("button", { name: "Notion" }));
		await waitFor(() =>
			expect(settings.current.mcpServers).toEqual({
				notion: { url: "https://mcp.notion.com/mcp", authType: "oauth" },
			}),
		);
		// Conductor's add ends on the Installed tab, where the new row connects.
		expect(screen.getByRole("tab", { name: "Installed" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		await waitFor(() => expect(opened).toHaveBeenCalled());
		await openTab("Recommended");
		expect(await screen.findByRole("group", { name: "Notion, installed" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Notion" })).toBeNull();
	});

	it("asks for the user's own client before connecting Asana", async () => {
		await mount(empty());
		await openTab("Recommended");
		fireEvent.click(await screen.findByRole("button", { name: "Asana" }));
		const dialog = await screen.findByRole("dialog", { name: "Connect Asana" });
		expect(
			within(dialog).getByText(/Asana requires credentials from your own Asana app\./),
		).toBeTruthy();
		expect(within(dialog).getByText("https://w.example.dev/mcp-oauth/callback")).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
		expect(await within(dialog).findByText("Enter a client ID")).toBeTruthy();
	});

	it("shows Datadog's sites and the redirect URL to allow", async () => {
		const settings = empty();
		const mounted = await mount(settings);
		vi.spyOn(mounted.container.platform.opener, "openUrl").mockResolvedValue();
		await openTab("Recommended");
		fireEvent.click(await screen.findByRole("button", { name: "Datadog" }));
		const dialog = await screen.findByRole("dialog", { name: "Connect Datadog" });
		expect(within(dialog).getByLabelText("Datadog site").textContent).toContain("US1");
		expect(
			within(dialog).getByText("Organization Settings → Preferences → MCP OAuth Redirect URLs"),
		).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Add and connect" }));
		await waitFor(() =>
			expect(settings.current.mcpServers).toEqual({
				datadog: { url: "https://mcp.datadoghq.com/v1/mcp", authType: "oauth" },
			}),
		);
	});

	it("imports a server without headers as OAuth when the Worker finds it needs a sign-in", async () => {
		const settings = empty();
		await mount(settings, twoInCursor);
		worker.answer = (
			(original) => (request: { method: string; path: string; body?: unknown }) =>
				request.path === "/mcp-oauth/detect"
					? ok({
							status: 200,
							body: JSON.stringify({
								authType: (request.body as { url: string }).url.includes("alpha")
									? "oauth"
									: "none",
							}),
						})
					: original(request)
		)(worker.answer.bind(worker));
		const dialog = await openImport();
		fireEvent.click(await within(dialog).findByRole("button", { name: "Add 2 MCP servers" }));
		await waitFor(() =>
			expect(settings.current.mcpServers).toEqual({
				alpha: { url: "https://alpha.example.com/mcp", authType: "oauth" },
				beta: { url: "https://beta.example.com/mcp", authType: "none" },
			}),
		);
	});
});
