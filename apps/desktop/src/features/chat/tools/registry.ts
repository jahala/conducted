/**
 * @feature CHAT-08 Tool card registry
 * Owns: the table from canonical tool name to the card component that shows it.
 * Behaviour: frontend.md 5 (registry keys include bash, edit, glob, grep, ls, read, skill, sub-agent, task,
 * todo, web, write, and an unknown-tool fallback).
 * Our design choice: the table is typed `Record<CanonicalTool, ...>`, so adding a tool to the protocol without a
 * card fails to compile. One file per card in ./cards. "unknown" and "mcp" share the generic look, with
 * their own files so they can differ later.
 * Must handle: every CanonicalTool has an entry; an entry is never undefined.
 * Test first: every name in CANONICAL_TOOLS resolves to a component, and "unknown" resolves to GenericToolCard.
 */
import type { CanonicalTool } from "@conducted/protocol";
import type { ComponentType } from "react";
import { AppToolCard } from "./cards/AppToolCard.tsx";
import { AskUserQuestionCard } from "./cards/AskUserQuestionCard.tsx";
import { BashCard } from "./cards/BashCard.tsx";
import { BashOutputCard } from "./cards/BashOutputCard.tsx";
import { EditCard } from "./cards/EditCard.tsx";
import { EnterPlanModeCard } from "./cards/EnterPlanModeCard.tsx";
import { ExitPlanModeCard } from "./cards/ExitPlanModeCard.tsx";
import { GenericToolCard } from "./cards/GenericToolCard.tsx";
import { GlobCard } from "./cards/GlobCard.tsx";
import { GrepCard } from "./cards/GrepCard.tsx";
import { ImageGenerationCard } from "./cards/ImageGenerationCard.tsx";
import { ImageViewCard } from "./cards/ImageViewCard.tsx";
import { ListCard } from "./cards/ListCard.tsx";
import { McpCard } from "./cards/McpCard.tsx";
import { MonitorCard } from "./cards/MonitorCard.tsx";
import { MultiEditCard } from "./cards/MultiEditCard.tsx";
import { NodeReplCard } from "./cards/NodeReplCard.tsx";
import { NotebookEditCard } from "./cards/NotebookEditCard.tsx";
import { ReadCard } from "./cards/ReadCard.tsx";
import { ScheduleWakeupCard } from "./cards/ScheduleWakeupCard.tsx";
import { SendMessageCard } from "./cards/SendMessageCard.tsx";
import { SkillCard } from "./cards/SkillCard.tsx";
import { SlashCommandCard } from "./cards/SlashCommandCard.tsx";
import { SubAgentCard } from "./cards/SubAgentCard.tsx";
import { TaskCreateCard } from "./cards/TaskCreateCard.tsx";
import { TaskGetCard } from "./cards/TaskGetCard.tsx";
import { TaskListCard } from "./cards/TaskListCard.tsx";
import { TaskStopCard } from "./cards/TaskStopCard.tsx";
import { TaskUpdateCard } from "./cards/TaskUpdateCard.tsx";
import { TeammateCard } from "./cards/TeammateCard.tsx";
import { TodoCard } from "./cards/TodoCard.tsx";
import { ToolSearchCard } from "./cards/ToolSearchCard.tsx";
import { WebFetchCard } from "./cards/WebFetchCard.tsx";
import { WebSearchCard } from "./cards/WebSearchCard.tsx";
import { WriteCard } from "./cards/WriteCard.tsx";
import type { ToolCardProps } from "./tool-card-props.ts";

export type ToolCardComponent = ComponentType<ToolCardProps>;

export const TOOL_CARDS: Record<CanonicalTool, ToolCardComponent> = {
	read: ReadCard,
	write: WriteCard,
	edit: EditCard,
	multi_edit: MultiEditCard,
	notebook_edit: NotebookEditCard,
	bash: BashCard,
	bash_output: BashOutputCard,
	glob: GlobCard,
	grep: GrepCard,
	list: ListCard,
	web_fetch: WebFetchCard,
	web_search: WebSearchCard,
	sub_agent: SubAgentCard,
	todo: TodoCard,
	ask_user_question: AskUserQuestionCard,
	enter_plan_mode: EnterPlanModeCard,
	exit_plan_mode: ExitPlanModeCard,
	skill: SkillCard,
	slash_command: SlashCommandCard,
	task_create: TaskCreateCard,
	task_get: TaskGetCard,
	task_list: TaskListCard,
	task_update: TaskUpdateCard,
	task_stop: TaskStopCard,
	monitor: MonitorCard,
	image_view: ImageViewCard,
	image_generation: ImageGenerationCard,
	node_repl: NodeReplCard,
	tool_search: ToolSearchCard,
	schedule_wakeup: ScheduleWakeupCard,
	send_message: SendMessageCard,
	teammate: TeammateCard,
	app_tool: AppToolCard,
	mcp: McpCard,
	unknown: GenericToolCard,
};

export function toolCardFor(tool: CanonicalTool): ToolCardComponent {
	return TOOL_CARDS[tool];
}
