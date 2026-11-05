/**
 * @feature CHAT-08 App tool card
 * Owns: The card for this app's own tools that the agent calls: workspace diff, diff comments,
 * terminal output, progress updates, target branch.
 * Behaviour: ui-map.md 3.3 (Conductor MCP cards: 'Workspace diff', 'Review comments', 'Code review
 * comments', 'Get terminal output' with source and line count, 'User input'), claude-runner.md 4.2.
 * Must handle: Which app tool it is comes from the raw name (APP_TOOLS in the protocol); an app
 * tool name the card does not know falls back to the generic look; GetTerminalOutput shows the
 * source and line count; UpdateProgress shows nothing here, the progress line above the composer
 * shows it.
 * Test first: A GetTerminalOutput call renders the terminal's name and the number of lines
 * returned.
 */
import { formatJson, ToolCardFrame, textField, textLines, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const TITLES: Record<string, string> = {
	GetWorkspaceDiff: "Workspace diff",
	GetDiffComments: "Review comments",
	DiffComment: "Code review comments",
	GetTerminalOutput: "Get terminal output",
	SetTargetBranch: "Set target branch",
};

const SOURCES: Record<string, string> = {
	spotlight: "Spotlight",
	run_script: "Run script",
	terminal: "Terminal",
	auto: "Auto",
};

/** `mcp__conducted__GetTerminalOutput` names the tool after the last double underscore. */
function appToolName(rawName: string): string {
	const parts = rawName.split("__");
	return parts.at(-1) ?? rawName;
}

export function AppToolCard({ call, defaultExpanded }: ToolCardProps) {
	const name = appToolName(call.item.rawName);
	if (name === "UpdateProgress") return null;
	const title = TITLES[name] ?? name;
	const input = call.item.input;
	const output = call.result?.output ?? "";
	const source = textField(input, "source") ?? "auto";
	const terminal = SOURCES[source] ?? source;
	const lineCount = textLines(output).length;
	const summary =
		name === "GetTerminalOutput"
			? `${terminal} · ${lineCount} ${lineCount === 1 ? "line" : "lines"}`
			: name === "SetTargetBranch"
				? (textField(input, "targetBranch") ?? undefined)
				: undefined;
	return (
		<ToolCardFrame
			title={title}
			summary={summary}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<pre className="overflow-x-auto whitespace-pre-wrap rounded-sm bg-surface p-2 font-mono text-xs text-fg-muted">
						{formatJson(input)}
					</pre>
					{output.length > 0 ? (
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg">
							{output}
						</pre>
					) : null}
				</div>
			}
		/>
	);
}
