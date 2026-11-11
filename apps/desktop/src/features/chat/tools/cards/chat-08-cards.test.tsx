import type { CanonicalTool } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { notImplemented, ok } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../../core/context.tsx";
import type { ChatBlock, ToolCallView } from "../../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../../test/container.ts";
import { TOOL_CARDS } from "../registry.ts";
import { AppToolCard } from "./AppToolCard.tsx";
import { BashCard } from "./BashCard.tsx";
import { BashOutputCard } from "./BashOutputCard.tsx";
import { EditCard } from "./EditCard.tsx";
import { GenericToolCard } from "./GenericToolCard.tsx";
import { GlobCard } from "./GlobCard.tsx";
import { GrepCard } from "./GrepCard.tsx";
import { ListCard } from "./ListCard.tsx";
import { McpCard } from "./McpCard.tsx";
import { MultiEditCard } from "./MultiEditCard.tsx";
import { NotebookEditCard } from "./NotebookEditCard.tsx";
import { ReadCard } from "./ReadCard.tsx";
import { SkillCard } from "./SkillCard.tsx";
import { SlashCommandCard } from "./SlashCommandCard.tsx";
import { SubAgentCard } from "./SubAgentCard.tsx";
import { WebFetchCard } from "./WebFetchCard.tsx";
import { WebSearchCard } from "./WebSearchCard.tsx";
import { WriteCard } from "./WriteCard.tsx";

const sessionId = "s1" as SessionId;

const openUrl = vi.fn();
let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
	vi.spyOn(test.container.actions.app, "openUrl").mockImplementation(openUrl);
});

/** The web cards open addresses through the action table. */
const withActions = (ui: ReactNode) => (
	<ServicesProvider container={test.container}>{ui}</ServicesProvider>
);

let sequence = 0;

interface Extra {
	rawName?: string;
	output?: string;
	isError?: boolean;
	truncated?: boolean;
	blocks?: ChatBlock[];
}

function view(
	tool: CanonicalTool,
	input: unknown,
	{ rawName, output, isError = false, truncated = false, blocks = [] }: Extra = {},
): ToolCallView {
	sequence += 1;
	const toolUseId = `tu-${sequence}` as ToolCallView["toolUseId"];
	return {
		toolUseId,
		item: { kind: "tool_call", toolUseId, tool, rawName: rawName ?? tool, input },
		result:
			output === undefined ? null : { kind: "tool_result", toolUseId, output, isError, truncated },
		blocks,
	};
}

async function renderInRouter(ui: ReactNode) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <ServicesProvider container={test.container}>{ui}</ServicesProvider>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(<RouterProvider router={router} />);
	await router.load();
	return router;
}

afterEach(() => {
	cleanup();
	openUrl.mockReset();
	test.close();
});

describe("CHAT-08 slash command card", () => {
	it("renders the command with its arguments", () => {
		render(
			<SlashCommandCard
				call={view("slash_command", { command: "review", args: "--deep" })}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("/review --deep")).toBeTruthy();
	});
});

describe("CHAT-08 edit card", () => {
	it("renders removed and added lines with their markers", async () => {
		await renderInRouter(
			<EditCard
				call={view("edit", {
					file_path: "src/a.ts",
					old_string: "old line",
					new_string: "new line",
				})}
				sessionId={sessionId}
			/>,
		);
		const diff = document.querySelector("pre");
		expect(diff?.textContent).toContain("-old line");
		expect(diff?.textContent).toContain("+new line");
		expect(screen.getByRole("button", { name: "Open in editor" })).toBeTruthy();
	});

	it("shows the retry note when the edit failed because the file was not read yet", async () => {
		await renderInRouter(
			<EditCard
				call={view(
					"edit",
					{ file_path: "src/a.ts", old_string: "old", new_string: "new" },
					{
						output: "File has not been read yet. Read it first before writing to it.",
						isError: true,
					},
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText(/Claude Code has to retry the file edit/)).toBeTruthy();
	});

	it("leaves the retry note out when the edit failed for another reason", async () => {
		await renderInRouter(
			<EditCard
				call={view(
					"edit",
					{ file_path: "src/a.ts", old_string: "old", new_string: "new" },
					{ output: "String to replace not found in file.", isError: true },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.queryByText(/Claude Code has to retry the file edit/)).toBeNull();
	});
});

describe("CHAT-08 skill card", () => {
	it("renders 'Skill activated' and the skill name", () => {
		render(<SkillCard call={view("skill", { skill: "pdf" })} sessionId={sessionId} />);
		expect(screen.getByText("Skill activated")).toBeTruthy();
		expect(screen.getByText("pdf")).toBeTruthy();
	});
});

describe("CHAT-08 sub-agent card", () => {
	it("shows Subagent, the description, and the nested cards", async () => {
		const blocks: ChatBlock[] = [
			{ kind: "tool", call: view("bash", { command: "ls" }, { rawName: "Bash" }) },
			{ kind: "tool", call: view("read", { file_path: "src/a.ts" }, { rawName: "Read" }) },
		];
		await renderInRouter(
			<SubAgentCard
				call={view("sub_agent", { description: "Look into it" }, { blocks })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Subagent")).toBeTruthy();
		expect(screen.getByText("Look into it")).toBeTruthy();
		expect(screen.getAllByText("Bash")).toHaveLength(1);
		// A read with no result yet is titled "Reading", as in Conductor.
		expect(screen.getAllByText("Reading")).toHaveLength(1);
	});

	it("shows the sub-agent's final answer", async () => {
		await renderInRouter(
			<SubAgentCard
				call={view("sub_agent", { description: "Look into it" }, { output: "Found two callers." })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Found two callers.")).toBeTruthy();
	});

	it("keeps the other nested cards when one nested card throws, and when one is a placeholder", async () => {
		const original = { bash: TOOL_CARDS.bash, task_create: TOOL_CARDS.task_create };
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		TOOL_CARDS.bash = () => {
			throw new Error("render failed");
		};
		TOOL_CARDS.task_create = () => notImplemented("CHAT-09");
		try {
			const blocks: ChatBlock[] = [
				{ kind: "tool", call: view("bash", { command: "ls" }, { rawName: "Bash" }) },
				{ kind: "tool", call: view("task_create", {}, { rawName: "TaskCreate" }) },
				{ kind: "tool", call: view("read", { file_path: "src/a.ts" }, { rawName: "Read" }) },
			];
			await renderInRouter(
				<SubAgentCard
					call={view("sub_agent", { description: "Look into it" }, { blocks })}
					sessionId={sessionId}
					defaultExpanded
				/>,
			);
			expect(screen.getByText("Tool: Bash: This part failed to load.")).toBeTruthy();
			expect(screen.getByText("Tool: TaskCreate: Not built yet: CHAT-09")).toBeTruthy();
			expect(screen.getByText("Reading")).toBeTruthy();
		} finally {
			Object.assign(TOOL_CARDS, original);
			log.mockRestore();
		}
	});
});

describe("CHAT-08 grep card", () => {
	it("renders its pattern and one group per matching file", () => {
		render(
			<GrepCard
				call={view(
					"grep",
					{ pattern: "needle" },
					{ output: "src/a.ts:3:first\nsrc/b.ts:9:second" },
				)}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		// Conductor's row reads "grep for '<pattern>'".
		expect(screen.getByText("grep for 'needle'")).toBeTruthy();
		expect(screen.getByText("src/a.ts")).toBeTruthy();
		expect(screen.getByText("src/b.ts")).toBeTruthy();
	});
});

describe("CHAT-08 app tool card", () => {
	it("renders the terminal source and its line count", () => {
		render(
			<AppToolCard
				call={view(
					"app_tool",
					{ source: "run_script" },
					{
						rawName: "mcp__conducted__GetTerminalOutput",
						output: "one\ntwo\nthree",
					},
				)}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("Get terminal output")).toBeTruthy();
		expect(screen.getByText("Run script · 3 lines")).toBeTruthy();
	});

	it.each([
		["mcp__conducted__GetWorkspaceDiff", "Workspace diff"],
		["mcp__conducted__GetDiffComments", "Review comments"],
		["mcp__conducted__DiffComment", "Code review comments"],
	])("names %s as %s", (rawName, title) => {
		render(<AppToolCard call={view("app_tool", {}, { rawName })} sessionId={sessionId} />);
		expect(screen.getByText(title)).toBeTruthy();
	});

	it("shows nothing for a progress update", () => {
		const { container } = render(
			<AppToolCard
				call={view(
					"app_tool",
					{ title: "Working" },
					{ rawName: "mcp__conducted__UpdateProgress", output: "Progress updated." },
				)}
				sessionId={sessionId}
			/>,
		);
		expect(container.textContent).toBe("");
	});
});

describe("CHAT-08 bash card", () => {
	it("shows the command line and the output text", () => {
		render(
			<BashCard
				call={view("bash", { command: "echo hi" }, { rawName: "Bash", output: "hello\nworld" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getAllByText("echo hi").length).toBeGreaterThan(0);
		expect(screen.getByText(/hello\s+world/)).toBeTruthy();
		expect(screen.getByText("Input:")).toBeTruthy();
	});

	it("clears the output and switches the input to raw JSON", () => {
		render(
			<BashCard
				call={view("bash", { command: "echo hi" }, { rawName: "Bash", output: "hello" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("hello")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Clear output" }));
		expect(screen.queryByText("hello")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Raw" }));
		expect(screen.getByText(/"command": "echo hi"/)).toBeTruthy();
	});

	it("shows Failed when the result has an error", () => {
		render(
			<BashCard
				call={view(
					"bash",
					{ command: "false" },
					{ rawName: "Bash", output: "exit 1", isError: true },
				)}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("Failed")).toBeTruthy();
	});
});

describe("CHAT-08 list card", () => {
	it("renders the directory path and its entries", () => {
		render(
			<ListCard
				call={view("list", { path: "src" }, { output: "a.ts\nb/" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("src")).toBeTruthy();
		expect(screen.getByText("a.ts")).toBeTruthy();
		expect(screen.getByText("b/")).toBeTruthy();
	});
});

describe("CHAT-08 multi-edit card", () => {
	it("renders three diff parts in call order", () => {
		render(
			<MultiEditCard
				call={view("multi_edit", {
					file_path: "src/a.ts",
					edits: [
						{ old_string: "one", new_string: "two" },
						{ old_string: "three", new_string: "four" },
						{ old_string: "five", new_string: "six" },
					],
				})}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Edit 1")).toBeTruthy();
		expect(screen.getByText("Edit 2")).toBeTruthy();
		expect(screen.getByText("Edit 3")).toBeTruthy();
	});
});

describe("CHAT-08 write card", () => {
	it("renders the path and content, and Open in editor asks for edit mode", async () => {
		const router = await renderInRouter(
			<WriteCard
				call={view("write", { file_path: "src/a.ts", content: "first\nsecond" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		// The row names the file in a badge with its own name; the full path is the badge's tooltip.
		expect(screen.getByText("a.ts").closest("button")?.getAttribute("title")).toBe("src/a.ts");
		const diff = document.querySelector("pre");
		expect(diff?.textContent).toContain("+first");
		expect(diff?.textContent).toContain("+second");
		fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({ tab: "file", fileMode: "edit" }),
		);
	});
});

describe("CHAT-08 glob card", () => {
	it("lists three matching paths", async () => {
		await renderInRouter(
			<GlobCard
				call={view("glob", { pattern: "**/*.ts" }, { output: "a.ts\nb.ts\nc.ts" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByRole("button", { name: "a.ts" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "b.ts" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "c.ts" })).toBeTruthy();
	});
});

describe("CHAT-08 read card", () => {
	it("shows the path and opens the file tab when it is clicked", async () => {
		const router = await renderInRouter(
			<ReadCard
				call={view("read", { file_path: "src/a.ts" }, { output: "export const a = 1;" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		// The row's file badge shows the file's own name, with the full path as its tooltip.
		const link = screen.getByTitle("src/a.ts");
		fireEvent.click(link);
		await waitFor(() =>
			expect(router.state.location.search).toMatchObject({ tab: "file", path: "src/a.ts" }),
		);
	});
});

describe("CHAT-08 MCP card", () => {
	it("splits the server and tool from the raw name", () => {
		render(
			<McpCard
				call={view("mcp", { id: "ISSUE-1" }, { rawName: "mcp__linear__get_issue" })}
				sessionId={sessionId}
			/>,
		);
		expect(screen.getByText("linear")).toBeTruthy();
		expect(screen.getByText("get_issue")).toBeTruthy();
	});
});

describe("CHAT-08 bash output card", () => {
	it("shows the new output lines", () => {
		render(
			<BashOutputCard
				call={view("bash_output", { bash_id: "shell-1" }, { output: "new output" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("new output")).toBeTruthy();
	});
});

describe("CHAT-08 generic tool card", () => {
	it("shows the raw name and the input as JSON", () => {
		render(
			<GenericToolCard
				call={view("unknown", { foo: "bar" }, { rawName: "FooTool" })}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("FooTool")).toBeTruthy();
		expect(screen.getByText(/"foo": "bar"/)).toBeTruthy();
	});
});

describe("CHAT-08 web search card", () => {
	it("shows the query and one row per result", () => {
		openUrl.mockResolvedValue(ok(undefined));
		render(
			withActions(
				<WebSearchCard
					call={view(
						"web_search",
						{ query: "weather" },
						{ output: "Result one\nhttps://one.test\nResult two\nhttps://two.test" },
					)}
					sessionId={sessionId}
					defaultExpanded
				/>,
			),
		);
		expect(screen.getByText("weather")).toBeTruthy();
		expect(screen.getByText("Result one")).toBeTruthy();
		expect(screen.getByText("Result two")).toBeTruthy();
		const link = screen.getByRole("link", { name: "Result one" });
		expect(link.getAttribute("href")).toBe("https://one.test");
		expect(link.getAttribute("target")).toBeNull();
		fireEvent.click(link);
		expect(openUrl).toHaveBeenCalledWith("https://one.test");
	});
});

describe("CHAT-08 notebook edit card", () => {
	it("shows the cell number and the new source", () => {
		render(
			<NotebookEditCard
				call={view("notebook_edit", {
					notebook_path: "nb.ipynb",
					cell_number: 3,
					new_source: "print(1)",
					edit_mode: "replace",
				})}
				sessionId={sessionId}
				defaultExpanded
			/>,
		);
		expect(screen.getByText("Replace cell 3")).toBeTruthy();
		expect(screen.getByText("print(1)")).toBeTruthy();
	});
});

describe("CHAT-08 web fetch card", () => {
	it("shows the host and the full address on hover", () => {
		const address = "https://example.com/page";
		openUrl.mockResolvedValue(ok(undefined));
		render(
			withActions(
				<WebFetchCard
					call={view("web_fetch", { url: address }, { output: "Some page text" })}
					sessionId={sessionId}
				/>,
			),
		);
		expect(screen.getByText("example.com")).toBeTruthy();
		fireEvent.click(screen.getByTitle(address));
		expect(openUrl).toHaveBeenCalledWith(address);
	});

	it("shows an address that is not a web address as text, not a link", () => {
		render(
			withActions(
				<WebFetchCard
					call={view("web_fetch", { url: "javascript:alert(1)" }, { output: "x" })}
					sessionId={sessionId}
				/>,
			),
		);
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
	});
});
