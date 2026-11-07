import type { AgentInstall } from "@conducted/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentDisplayName } from "../../../core/services/agent-catalog.ts";
import { AgentCard, agentState } from "./AgentCard.tsx";

const install = (changes: Partial<AgentInstall> = {}): AgentInstall => ({
	agent: "claude",
	installed: true,
	authenticated: false,
	version: "2.0.0",
	path: "/Users/me/.local/bin/claude",
	source: "login_path",
	...changes,
});

const renderCard = (
	value: AgentInstall,
	overrides: Partial<Parameters<typeof AgentCard>[0]> = {},
) =>
	render(
		<AgentCard
			install={value}
			signInBusy={false}
			onSignIn={vi.fn()}
			onRefresh={vi.fn()}
			{...overrides}
		/>,
	);

afterEach(cleanup);

describe("SET-03 AgentCard", () => {
	// Conductor names the CLI sign-in after its command (renderApp @10941717).
	it("shows Run claude /login for an installed Claude that is not signed in", () => {
		renderCard(install());

		expect(screen.getByRole("button", { name: "Run claude /login" })).toBeTruthy();
		expect(screen.getByText("Loaded from env")).toBeTruthy();
		// The version is a row of Conductor's facts table now, not a "Version 2.0.0" line.
		expect(screen.getByText("Version")).toBeTruthy();
		expect(screen.getByText("2.0.0")).toBeTruthy();
	});

	it("keeps Run claude /login while signed in, as Conductor's capture shows", () => {
		renderCard(install({ authenticated: true }));

		expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
		expect(screen.getByRole("button", { name: "Run claude /login" })).toBeTruthy();
		// Conductor's status line says "Connected" for a signed-in agent.
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("AGENT-09 points a missing Cursor to the Advanced page, where the app installs its SDK", () => {
		renderCard(
			install({
				agent: "cursor",
				installed: false,
				path: undefined,
				version: undefined,
				authenticated: undefined,
			}),
		);

		expect(
			screen.getByText("Install the Cursor SDK on the Advanced page, then choose Refresh."),
		).toBeTruthy();
	});

	it("shows install help and no Sign in button when the program is missing", () => {
		renderCard(
			install({ installed: false, path: undefined, version: undefined, authenticated: undefined }),
		);

		expect(screen.getByText("Install Claude Code on this Mac, then choose Refresh.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Sign in|Run claude/ })).toBeNull();
		expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
	});

	it("names an ACP agent by its own name, not acp", () => {
		renderCard(install({ agent: "acp", acpAgent: "opencode" }));

		expect(screen.getByRole("heading", { name: "OpenCode" })).toBeTruthy();
		expect(screen.queryByText("acp")).toBeNull();
	});

	it("says when an API key is configured", () => {
		renderCard(install({ authMethod: "api_key", authenticated: true, source: "user" }));

		expect(screen.getByText("API key configured")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /Sign in|Run claude/ })).toBeNull();
	});

	it("marks a failing version check and offers Update when the page can update it", () => {
		const onUpdate = vi.fn();
		const warning = "This version can return empty ACP turns in Conductor.";
		renderCard(install({ warning }), { onUpdate });

		expect(screen.getByText("Validation failed")).toBeTruthy();
		expect(screen.getAllByText(warning).length).toBeGreaterThan(0);
		fireEvent.click(screen.getByRole("button", { name: "Update" }));
		expect(onUpdate).toHaveBeenCalledTimes(1);
	});
});

describe("SET-03 agent names and paths", () => {
	it.each([
		["claude", undefined, "Claude Code"],
		["codex", undefined, "Codex"],
		["cursor", undefined, "Cursor"],
		["acp", "opencode", "OpenCode"],
		["acp", "pi", "Pi"],
		["acp", undefined, "ACP agent"],
	] as const)("names %s %s as %s", (agent, acpAgent, expected) => {
		expect(agentDisplayName({ agent, acpAgent })).toBe(expected);
	});

	it("keeps both ends of a long path and the full path in the tooltip", () => {
		const path =
			"/Users/me/.local/share/conducted/agents/claude/2.0.0/node_modules/.bin/bin/claude";
		renderCard(install({ path }));

		const shown = screen.getByTitle(path);
		expect((shown.textContent ?? "").length).toBeLessThan(path.length);
		expect(shown.textContent?.startsWith("/Users/me")).toBe(true);
		expect(shown.textContent?.endsWith("/bin/claude")).toBe(true);
		expect(shown.textContent).toContain("…");
	});

	// Conductor's facts table (renderApp uFa @10931600): a fixed table whose label column is 128 px
	// on a faint muted fill, with 8 px by 12 px cells, one row per fact.
	it("lays out the facts as Conductor's dense table with a 128 px label column", () => {
		renderCard(install({ authenticated: true }));

		const table = screen.getByRole("table");
		expect(table.className).toContain("table-fixed");
		const label = screen.getByRole("rowheader", { name: "Version" });
		expect(label.className).toContain("w-32");
		expect(label.className).toContain("py-2");
		expect(screen.getByRole("cell", { name: "2.0.0" }).className).toContain("py-2");
	});

	// Conductor's Refresh (renderApp Mci @10933400): a small ghost button with a turning-arrows icon
	// that spins and is disabled while the check runs.
	it("shows Refresh with its icon, spinning and disabled while a refresh runs", () => {
		renderCard(install(), { refreshing: true });

		const refresh = screen.getByRole("button", { name: "Refresh" });
		expect((refresh as HTMLButtonElement).disabled).toBe(true);
		const icon = refresh.querySelector("svg");
		expect(icon).not.toBeNull();
		expect(icon?.getAttribute("class") ?? "").toContain("animate-spin");
	});

	it("maps the install source and sign-in method to Conductor's state words", () => {
		// The app's own copy gets no badge; "Recommended" was ours (D098).
		expect(agentState(install({ source: "managed" }))).toBeNull();
		expect(agentState(install({ source: "login_path" }))?.label).toBe("Loaded from env");
		expect(agentState(install({ source: "user" }))?.label).toBe("Custom path");
		expect(agentState(install({ authMethod: "api_key" }))?.label).toBe("API key configured");
		expect(agentState(install({ warning: "Missing" }))?.label).toBe("Validation failed");
		expect(agentState(install({ installed: false }))).toBeNull();
	});
});
