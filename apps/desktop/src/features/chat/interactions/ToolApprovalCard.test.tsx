/**
 * Tests for CHAT-11: the tool approval card asks about one tool call and sends the user's choice.
 */
import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import {
	appError,
	err,
	type InteractionId,
	ok,
	type SessionId,
	type ToolUseId,
} from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { ToolApprovalCard } from "./ToolApprovalCard.tsx";

const sessionId = "s1" as SessionId;
const interactionId = "i1" as InteractionId;

type ToolApproval = Extract<Interaction, { kind: "tool_approval" }>;
type ToolApprovalAnswer = Extract<InteractionAnswer, { kind: "tool_approval" }>;

const request = (changes: Partial<ToolApproval> = {}): ToolApproval => ({
	kind: "tool_approval",
	toolUseId: "tu1" as ToolUseId,
	toolName: "Bash",
	input: { command: "ls -la" },
	...changes,
});

let test: TestContainer;
let answer: ReturnType<typeof vi.fn>;

/** Tool cards open files through the router, so every approval renders inside one. */
async function renderCard(changes: Partial<ToolApproval> = {}) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<ServicesProvider container={test.container}>
				<ToolApprovalCard
					sessionId={sessionId}
					interactionId={interactionId}
					request={request(changes)}
				/>
			</ServicesProvider>
		),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	const result = render(<RouterProvider router={router} />);
	await router.load();
	return result;
}

const card = () => screen.getByRole("group", { name: "Tool approval" });

const sent = () => answer.mock.calls[0]?.[2] as ToolApprovalAnswer | undefined;

beforeEach(() => {
	test = createTestContainer();
	answer = vi.fn(async () => ok(undefined));
	test.container.actions.sessions.answer = answer as typeof test.container.actions.sessions.answer;
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("CHAT-11 tool approval card", () => {
	it("calls sessions.answer with allow when Enter is pressed on a bash approval", async () => {
		await renderCard();

		fireEvent.keyDown(card(), { key: "Enter" });

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "tool_approval",
				decision: "allow",
			}),
		);
	});

	it("sends deny when Backspace is pressed", async () => {
		await renderCard();

		fireEvent.keyDown(card(), { key: "Backspace" });

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "tool_approval",
				decision: "deny",
			}),
		);
	});

	it("follows a rebind of No from the Keyboard shortcuts page", async () => {
		test.container.services.settings.store.setState((state) => ({
			values: {
				...state.values,
				keybinding_overrides_v1: JSON.stringify({ "chat.denyTool": ["D"] }),
			},
		}));
		await renderCard();

		fireEvent.keyDown(card(), { key: "Backspace" });
		expect(answer).not.toHaveBeenCalled();
		fireEvent.keyDown(card(), { key: "d" });

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "tool_approval",
				decision: "deny",
			}),
		);
	});

	it("offers Yes always for a command and sends it on Cmd+Enter", async () => {
		await renderCard();

		expect(screen.getByRole("button", { name: "Yes always" })).toBeTruthy();
		fireEvent.keyDown(card(), { key: "Enter", metaKey: true });

		await waitFor(() => expect(sent()?.decision).toBe("always_allow"));
	});

	it("offers the edits choice for an edit and sends it on Cmd+Enter", async () => {
		await renderCard({ toolName: "Edit", input: { file_path: "src/a.ts" } });

		expect(
			screen.getByRole("button", { name: "Allow all edits during this session" }),
		).toBeTruthy();
		fireEvent.keyDown(card(), { key: "Enter", metaKey: true });

		await waitFor(() => expect(sent()?.decision).toBe("allow_edits_for_session"));
	});

	it("titles the card by the tool", async () => {
		const cases: Array<[string, string]> = [
			["Bash", "Do you want to run this command?"],
			["RunLocalCommand", "Do you want to run this command on your Mac?"],
			["Edit", "Do you want to make these changes?"],
			["MultiEdit", "Do you want to make these changes?"],
			["Task", "Do you want to run this agent?"],
			["WebSearch", "Do you want to do this search?"],
			["WebFetch", "Do you want to fetch this page?"],
			["CustomTool", "Do you want to run this tool?"],
		];

		for (const [toolName, title] of cases) {
			const { unmount } = await renderCard({ toolName });
			expect(screen.getByText(title)).toBeTruthy();
			unmount();
		}
	});

	it("shows the tool card and the decision reason", async () => {
		await renderCard({ reason: "Needs to inspect the folder." });

		expect(screen.getByRole("button", { name: "Raw" })).toBeTruthy();
		expect(screen.getAllByText("ls -la").length).toBeGreaterThan(0);
		expect(screen.getByText("Needs to inspect the folder.")).toBeTruthy();
	});

	it("does not call an MCP tool a web fetch", async () => {
		await renderCard({ toolName: "mcp__git__git_fetch_x", input: { repo: "conducted" } });

		expect(screen.getByText("Do you want to run this tool?")).toBeTruthy();
		expect(screen.queryByText("Do you want to fetch this page?")).toBeNull();
		expect(screen.getByText("git_fetch_x")).toBeTruthy();
	});

	it("marks a request from a sub-agent", async () => {
		await renderCard({ subAgentId: "agent-2" });

		expect(screen.getByText("Subagent")).toBeTruthy();
	});

	it("names a blocked path outside the workspace", async () => {
		await renderCard({ blockedPath: "/etc/hosts" });

		expect(screen.getByText(/outside this workspace/)).toBeTruthy();
		expect(screen.getByText("/etc/hosts")).toBeTruthy();
	});

	it("offers the suggested rule as the Cmd+Enter choice, in Conductor's words", async () => {
		await renderCard({ suggestedRules: ["Bash(npm test:*)"] });

		expect(
			screen.getByRole("button", { name: "Yes, and don't ask again for: Bash(npm test:*)" }),
		).toBeTruthy();
		fireEvent.keyDown(card(), { key: "Enter", metaKey: true });

		await waitFor(() => expect(sent()?.decision).toBe("allow_with_suggested_rules"));
	});

	it("names the suggested rule only in its button, with no rules list or wrench icon", async () => {
		await renderCard({ suggestedRules: ["Bash(npm test:*)", "Bash(npm run lint)"] });

		// Conductor's card names the first rule in its button (renderApp @105007) and shows no list (D098).
		expect(screen.queryByText("The agent suggests these rules:")).toBeNull();
		expect(screen.queryByText("Bash(npm run lint)")).toBeNull();
		expect(card().querySelector("svg + p")).toBeNull();
	});

	it("puts the optional deny message right under No, with no label of its own", async () => {
		await renderCard();

		const no = screen.getByRole("button", { name: "No" });
		const message = screen.getByRole("textbox", { name: "Message to the agent" });
		expect(no.nextElementSibling).toBe(message);
		expect(screen.queryByText("Message to the agent (optional)")).toBeNull();
	});

	it("cuts a long suggested rule at 40 characters, as Conductor does", async () => {
		const rule = `Bash(${"a".repeat(50)})`;
		await renderCard({ suggestedRules: [rule] });

		expect(
			screen.getByRole("button", {
				name: `Yes, and don't ask again for: ${rule.slice(0, 40)}...`,
			}),
		).toBeTruthy();
	});

	it("keeps our Yes always beside the suggested rule", async () => {
		await renderCard({ suggestedRules: ["Bash(npm test:*)"] });

		fireEvent.click(screen.getByRole("button", { name: "Yes always" }));

		await waitFor(() => expect(sent()?.decision).toBe("always_allow"));
	});

	it("names the tool in the always choice for MCP tools and web tools", async () => {
		for (const toolName of ["mcp__git__git_fetch_x", "WebSearch", "WebFetch"]) {
			const { unmount } = await renderCard({ toolName, input: {} });
			fireEvent.click(screen.getByRole("button", { name: `Always allow ${toolName}` }));
			await waitFor(() => expect(sent()?.decision).toBe("always_allow"));
			answer.mockClear();
			unmount();
		}
	});

	it("stacks Yes, the Cmd+Enter choice and No, each with its live key", async () => {
		await renderCard();

		const keyed = Array.from(card().querySelectorAll("button")).filter(
			(button) => button.querySelector("kbd") !== null,
		);
		expect(keyed.map((button) => button.querySelector("kbd")?.textContent)).toEqual([
			"↵",
			"⌘↵",
			"⌫",
		]);
		expect(keyed.map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(
			["Yes", "Yes always", "No"].map((name) => expect.stringContaining(name)),
		);
	});

	it("carries the deny message back to the agent", async () => {
		await renderCard();

		fireEvent.change(screen.getByLabelText("Message to the agent"), {
			target: { value: "Do not touch that folder." },
		});
		fireEvent.click(screen.getByRole("button", { name: "No" }));

		await waitFor(() =>
			expect(answer).toHaveBeenCalledWith(sessionId, interactionId, {
				kind: "tool_approval",
				decision: "deny",
				message: "Do not touch that folder.",
			}),
		);
	});

	it("ignores Enter while the user types the deny message", async () => {
		await renderCard();
		const message = screen.getByLabelText("Message to the agent");

		fireEvent.keyDown(message, { key: "Enter" });

		expect(answer).not.toHaveBeenCalled();
	});

	it("sends only one answer when a button is clicked twice", async () => {
		await renderCard();
		const no = screen.getByRole("button", { name: "No" });

		fireEvent.click(no);
		fireEvent.click(no);

		await waitFor(() => expect(answer).toHaveBeenCalledTimes(1));
		await Promise.resolve();
		expect(answer).toHaveBeenCalledTimes(1);
	});

	it("shows what was chosen after the answer", async () => {
		await renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Yes" }));

		expect(await screen.findByText("Allowed")).toBeTruthy();
	});

	it("comes back with the real message when the answer cannot be sent", async () => {
		answer
			.mockResolvedValueOnce(err(appError("sidecar_down", "The sidecar is not running.")))
			.mockResolvedValueOnce(ok(undefined));
		await renderCard();

		fireEvent.click(screen.getByRole("button", { name: "Yes" }));

		expect(
			await screen.findByText(/Could not send the answer: The sidecar is not running\./),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Yes" }));
		await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
	});

	it("does not take focus when the card arrives", async () => {
		await renderCard();

		expect(document.activeElement).toBe(document.body);
	});

	it("shows a long command in the tool card", async () => {
		const command = "x".repeat(600);
		await renderCard({ input: { command } });

		expect(screen.getByRole("button", { name: "Raw" })).toBeTruthy();
		expect(screen.getAllByText(command).length).toBeGreaterThan(0);
	});
});
