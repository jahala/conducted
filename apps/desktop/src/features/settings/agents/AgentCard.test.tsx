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
	it("shows Sign in for an installed Claude that is not signed in", () => {
		renderCard(install());

		expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
		expect(screen.getByText("Loaded from env")).toBeTruthy();
		expect(screen.getByText("Version 2.0.0")).toBeTruthy();
	});

	it("shows the signed-in state without a Sign in button", () => {
		renderCard(install({ authenticated: true }));

		expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
		expect(screen.getByText("Signed in")).toBeTruthy();
	});

	it("shows install help and no Sign in button when the program is missing", () => {
		renderCard(
			install({ installed: false, path: undefined, version: undefined, authenticated: undefined }),
		);

		expect(screen.getByText("Install Claude Code on this Mac, then choose Refresh.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
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
		expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
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

	it("maps the install source and sign-in method to Conductor's state words", () => {
		expect(agentState(install({ source: "managed" }))?.label).toBe("Recommended");
		expect(agentState(install({ source: "login_path" }))?.label).toBe("Loaded from env");
		expect(agentState(install({ source: "user" }))?.label).toBe("Custom path");
		expect(agentState(install({ authMethod: "api_key" }))?.label).toBe("API key configured");
		expect(agentState(install({ warning: "Missing" }))?.label).toBe("Validation failed");
		expect(agentState(install({ installed: false }))).toBeNull();
	});
});
