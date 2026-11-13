/**
 * @feature CHAT-08 Tool icons
 * Owns: the small icon each tool kind shows at the start of its row, and in a folded run of tool calls.
 * Behaviour: measured from Conductor 0.92.1 (renderApp, the tool-name icon switch): every tool row starts
 * with a 12px muted icon picked by the tool's kind; unknown tools get a wrench. The icons are our own line
 * drawings (ui/icons.tsx), drawn to the same subjects.
 * Must handle: every canonical tool has an icon (the table is a full Record, so a new tool fails to
 * compile); thinking, which is not a tool, has its own.
 * Test first: not applicable; the table is checked by the compiler and the rows' tests render it.
 */
import type { CanonicalTool } from "@conducted/protocol";
import { createContext, type ReactElement, type SVGProps, useContext } from "react";
import {
	BicepsIcon,
	BotIcon,
	BrainIcon,
	ClipboardListIcon,
	ClockIcon,
	FileCodeIcon,
	FilePenIcon,
	FileSearchIcon,
	FileTextIcon,
	GlobeIcon,
	ImageIcon,
	LaptopIcon,
	MessageSquareIcon,
	PromptIcon,
	RadioIcon,
	SearchIcon,
	SendIcon,
	SlashIcon,
	SquareCheckIcon,
	WrenchIcon,
} from "../../../ui/icons.tsx";

type IconComponent = (props: SVGProps<SVGSVGElement>) => ReactElement;

/** The icon per tool kind, following Conductor's mapping from its own tool names. */
export const TOOL_ICONS: Record<CanonicalTool, IconComponent> = {
	read: FileTextIcon,
	write: FilePenIcon,
	edit: FilePenIcon,
	multi_edit: FilePenIcon,
	notebook_edit: FilePenIcon,
	bash: PromptIcon,
	bash_output: PromptIcon,
	glob: FileSearchIcon,
	grep: SearchIcon,
	list: FileSearchIcon,
	web_fetch: GlobeIcon,
	web_search: GlobeIcon,
	sub_agent: FileCodeIcon,
	todo: SquareCheckIcon,
	ask_user_question: MessageSquareIcon,
	enter_plan_mode: ClipboardListIcon,
	exit_plan_mode: ClipboardListIcon,
	skill: BicepsIcon,
	slash_command: SlashIcon,
	task_create: SquareCheckIcon,
	task_get: SquareCheckIcon,
	task_list: SquareCheckIcon,
	task_update: SquareCheckIcon,
	task_stop: SquareCheckIcon,
	monitor: RadioIcon,
	image_view: ImageIcon,
	image_generation: ImageIcon,
	node_repl: PromptIcon,
	tool_search: SearchIcon,
	schedule_wakeup: ClockIcon,
	send_message: SendIcon,
	teammate: BotIcon,
	app_tool: LaptopIcon,
	mcp: WrenchIcon,
	unknown: WrenchIcon,
};

/** Thinking is not a tool, but its row starts with an icon like one. */
export const ThinkingIcon = BrainIcon;
/** A run of tool calls that includes sub-agents shows this icon for them. */
export const SubAgentIcon = BotIcon;

/** The 12px muted icon a row starts with. */
export function ToolIcon({ tool }: { tool: CanonicalTool }) {
	const Icon = TOOL_ICONS[tool];
	return <Icon className="size-3 text-fg-muted" />;
}

/**
 * The tool of the call a card belongs to, set by `ToolCard` around every card, so the shared row frame
 * draws the right icon without each card naming it.
 */
export const ToolKindContext = createContext<CanonicalTool | null>(null);

export function useToolKind(): CanonicalTool | null {
	return useContext(ToolKindContext);
}
