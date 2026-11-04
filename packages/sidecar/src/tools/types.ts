/**
 * @feature SIDE-12 App tools as an in-process MCP server
 * Owns: the shape of one app tool (name, description, input schema, run function) and what a tool
 * may use while it runs.
 * Behaviour: research/conductor/claude-runner.md section 4 "The Conductor MCP server": one tool list
 * exposed three ways (in-process for Claude, socket bridge for Codex and ACP, SDK objects for
 * Cursor). Our tools are the names in packages/protocol/src/tools.ts (APP_TOOLS); the cloud-only
 * tools are left out.
 * Must handle: nothing at runtime. A tool never touches the file system or git; it asks the app
 * through AppToolBackend and returns text.
 * Test first: none (types only). tools.test.ts checks the registry against APP_TOOLS.
 * Our design choice: a tool's result is plain text plus an error flag, which is all MCP needs and
 * all the chat shows.
 */
import type {
	AppTool,
	SessionConfig,
	sidecarToAppNotifications,
	zDiffCommentInput,
	zDiffCommentView,
	zQuestion,
} from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import type { z } from "zod";
import type { AppToolBackend } from "./backend.ts";

export type ToolShape = z.ZodRawShape;

export type Question = z.infer<typeof zQuestion>;
export type DiffCommentInput = z.infer<typeof zDiffCommentInput>;
export type DiffCommentView = z.infer<typeof zDiffCommentView>;
export type ProgressUpdate = Omit<
	z.infer<(typeof sidecarToAppNotifications)["progress"]>,
	"sessionId"
>;

export interface ToolResult {
	text: string;
	isError: boolean;
}

export interface ToolContext {
	sessionId: SessionId;
	backend: AppToolBackend;
}

export interface ToolDefinition<S extends ToolShape = ToolShape> {
	name: AppTool;
	description: string;
	inputShape: S;
	/** True when the tool only reads. Shown to the agent as a hint, and skips checkpoint waits. */
	readOnly: boolean;
	/** True when calling it twice with the same input has the same effect as once. */
	idempotent: boolean;
	/** True when the agent must see the tool at once instead of finding it through tool search. */
	alwaysLoad?: boolean;
	/** The SessionConfig.appTools switch that turns this tool on. Absent: always on. */
	enabledBy?: keyof SessionConfig["appTools"];
	execute(args: z.infer<z.ZodObject<S>>, context: ToolContext): Promise<ToolResult>;
}
