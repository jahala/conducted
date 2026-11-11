/**
 * @feature catalogue States of the cards an agent waits on, one per kind of request
 * Owns: a chat in arbor waiting on an edit, a sub-agent, a web search, a web fetch and a read of a
 * file outside the workspace, each with the card's title and choices for that kind of tool; a Codex
 * chat asking for network access beyond its sandbox; a multi-select question's "Select other
 * response"; and a question card after an answer that could not be sent.
 * Behaviour: ui-map.md 3.3 (approval titles by tool, the 'Network access' card);
 * features/chat/interactions/approval-tool.ts picks the title and the choices.
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { Interaction, SessionConfig } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import { animateCast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { conversation } from "../conversation.ts";
import { click, shows } from "../dom.ts";
import { openInteraction } from "../live.ts";
import { addChat, addEvents, CLAUDE_CONFIG } from "../seeds.ts";
import type { CatalogueState, Scene } from "../state.ts";
import { CATALOGUE_NOW, MINUTE } from "../time.ts";
import type { World } from "../world.ts";

const ARBOR = "/Users/sam/conducted/workspaces/atlas/arbor";

const CODEX_CONFIG: SessionConfig = { ...CLAUDE_CONFIG, agent: "codex", model: "gpt-5.5" };

interface Waiting {
	id: string;
	title: string;
	chat: string;
	ask: string;
	interaction: Interaction;
	/** Text the card shows once it is up. */
	ready: string;
	config?: SessionConfig;
}

/** arbor with a new chat whose agent waits on `waiting.interaction`. */
const waitingState = (waiting: Waiting): CatalogueState => ({
	id: waiting.id,
	group: "Workspace chat",
	title: waiting.title,
	seed: async (world: World): Promise<Scene> => {
		const cast = await seedCast(world);
		const config = waiting.config ?? CLAUDE_CONFIG;
		const chat = await addChat(world, cast.arbor, { title: waiting.chat, config });
		const talk = conversation(waiting.id, CATALOGUE_NOW - 4 * MINUTE);
		talk.user(waiting.ask, { config });
		await addEvents(world, chat.id, talk.events);
		return {
			route: chatRoute(cast.arbor, chat),
			after: async ({ app }) => {
				await animateCast(world, cast, app);
				await refreshGit(app, cast.arbor);
				openInteraction(world, chat.id, `${waiting.id}-ask`, waiting.interaction);
			},
			ready: (document) => shows(document, waiting.ready),
		};
	},
});

const toolUse = (id: string) => `${id}-tool` as ToolUseId;

export const APPROVAL_STATES: CatalogueState[] = [
	waitingState({
		id: "chat-approval-edit",
		title: "Approval for an edit, with the choice to allow every edit in this chat",
		chat: "Wrap long company names",
		ask: "The invoice PDF cuts off long company names. Wrap them instead.",
		interaction: {
			kind: "tool_approval",
			toolUseId: toolUse("edit"),
			toolName: "Edit",
			input: {
				file_path: `${ARBOR}/src/invoices/pdf-header.ts`,
				old_string: "  doc.text(company.name, 40, 60);",
				new_string: "  doc.text(company.name, 40, 60, { width: 220, lineBreak: true });",
			},
		},
		ready: "Allow all edits during this session",
	}),
	waitingState({
		id: "chat-approval-agent",
		title: "Approval for a sub-agent",
		chat: "Find slow queries",
		ask: "Search takes two seconds on large accounts. Find out why.",
		interaction: {
			kind: "tool_approval",
			toolUseId: toolUse("agent"),
			toolName: "Task",
			input: {
				description: "Profile the search query",
				prompt:
					"Run EXPLAIN on the search query for the largest account and report the slow steps.",
				subagent_type: "general-purpose",
			},
		},
		ready: "Do you want to run this agent?",
	}),
	waitingState({
		id: "chat-approval-search",
		title: "Approval for a web search",
		chat: "Upgrade the PDF library",
		ask: "Is there a newer pdfkit with better text wrapping?",
		interaction: {
			kind: "tool_approval",
			toolUseId: toolUse("search"),
			toolName: "WebSearch",
			input: { query: "pdfkit changelog text wrapping lineBreak" },
		},
		ready: "Do you want to do this search?",
	}),
	waitingState({
		id: "chat-approval-fetch",
		title: "Approval for fetching a web page",
		chat: "Read the release notes",
		ask: "Read Node 24's release notes and list what could break us.",
		interaction: {
			kind: "tool_approval",
			toolUseId: toolUse("fetch"),
			toolName: "WebFetch",
			input: {
				url: "https://nodejs.org/en/blog/release/v24.0.0",
				prompt: "List the breaking changes.",
			},
		},
		ready: "Do you want to fetch this page?",
	}),
	waitingState({
		id: "chat-approval-outside",
		title: "Approval for reading a file outside the workspace",
		chat: "Use the shared lint rules",
		ask: "Use the same lint rules as the relay project.",
		interaction: {
			kind: "tool_approval",
			toolUseId: toolUse("outside"),
			toolName: "Read",
			input: { file_path: "/Users/sam/code/relay/biome.json" },
			reason: "The file is outside this workspace.",
			blockedPath: "/Users/sam/code/relay/biome.json",
		},
		ready: "Do you want to run this tool?",
	}),
	waitingState({
		id: "chat-permission-network",
		title: "Codex asks for network access beyond its sandbox",
		chat: "Refresh the lockfile",
		ask: "Refresh the lockfile so it picks up the patched pdfkit.",
		config: CODEX_CONFIG,
		interaction: {
			kind: "permission_grant",
			description: "Run pnpm install, which downloads packages from the registry.",
			reason: "The sandbox blocks the network, and the lockfile needs the registry.",
			paths: [],
			network: true,
		},
		ready: "Network access",
	}),
	waitingState({
		id: "chat-question-multi",
		title: "A multi-select question, with the Other answer selectable",
		chat: "Pick the checks",
		ask: "Add the missing checks to the release pipeline.",
		interaction: {
			kind: "question",
			questions: [
				{
					question: "Which checks should run before a release?",
					options: [
						{ label: "Typecheck", description: "Runs tsc over the whole repository." },
						{ label: "Unit tests", description: "The fast Vitest suite." },
					],
					multiSelect: true,
				},
			],
		},
		ready: "Which checks should run before a release?",
	}),
	{
		id: "chat-question-answer-failed",
		group: "Workspace chat",
		title: "A question card after an answer that could not be sent",
		seed: async (world: World): Promise<Scene> => {
			const cast = await seedCast(world);
			const chat = await addChat(world, cast.arbor, { title: "Pick the database" });
			const talk = conversation("question-failed", CATALOGUE_NOW - 4 * MINUTE);
			talk.user("Set up the local database for the new service.");
			await addEvents(world, chat.id, talk.events);
			world.failSidecar("answerInteraction");
			return {
				route: chatRoute(cast.arbor, chat),
				after: async ({ app, document }) => {
					await animateCast(world, cast, app);
					await refreshGit(app, cast.arbor);
					openInteraction(world, chat.id, "question-failed-ask", {
						kind: "question",
						questions: [
							{
								question: "Which database should the service use?",
								options: [{ label: "SQLite", description: "One file, nothing to run." }],
								multiSelect: false,
							},
						],
					});
					await click(document, "[role=radio]", "SQLite");
					await click(document, "button", "Submit");
				},
				ready: (document) => shows(document, "Could not send answers. Try again."),
			};
		},
	},
];
