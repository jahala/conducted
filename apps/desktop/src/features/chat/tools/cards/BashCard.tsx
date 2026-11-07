/**
 * @feature CHAT-08 Bash card
 * Owns: The card for a shell command: the command, its output and whether it succeeded.
 * Behaviour: ui-map.md 3.3 (Bash with 'Clear output', 'Formatted' and 'Raw' JSON toggle, 'Input:').
 * Must handle: Running (output streams in); non-zero exit shown as failed; output truncated by the
 * runner (labelled); very long output scrolls inside a limited height; ANSI colour codes are
 * stripped or rendered, not shown raw; a background command (links to its BashOutputCard).
 * Test first: A bash call with output shows the command line and the output text; a result with
 * isError shows Failed.
 */

import { useState } from "react";
import { stripTerminalEscapes } from "../../../../platform/terminal-escapes.ts";
import {
	asRecord,
	boolField,
	formatJson,
	ToolCardFrame,
	ToolOutput,
	textField,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function BashCard({ call, defaultExpanded }: ToolCardProps) {
	const [cleared, setCleared] = useState(false);
	const [raw, setRaw] = useState(false);
	const input = asRecord(call.item.input);
	const command = textField(input, "command", "cmd") ?? "";
	const description = textField(input, "description");
	const output = stripTerminalEscapes(call.result?.output ?? "");
	const background = boolField(input, "run_in_background");
	const hasOutput = output.length > 0 && !cleared;
	return (
		<ToolCardFrame
			title={description !== null && description.length > 0 ? description : "Bash"}
			summary={command}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					<span className="text-xs font-medium text-fg-subtle">Input:</span>
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-canvas p-2 font-mono text-xs text-fg-muted">
						{raw ? formatJson(input) : command}
					</pre>
					{background ? (
						<p className="text-xs text-fg-subtle">
							Running in the background; its new output appears in the Bash output card.
						</p>
					) : null}
					{hasOutput ? <ToolOutput>{output}</ToolOutput> : null}
					{call.result?.truncated ? (
						<p className="text-xs text-fg-subtle">Output was cut; the start and end are shown.</p>
					) : null}
				</div>
			}
			footer={
				<div className="flex items-center gap-3">
					{output.length > 0 ? (
						<button
							type="button"
							onClick={() => setCleared(true)}
							className="text-xs font-medium text-fg-muted hover:text-fg"
						>
							Clear output
						</button>
					) : null}
					<button
						type="button"
						onClick={() => setRaw(!raw)}
						className="text-xs font-medium text-fg-muted hover:text-fg"
					>
						{raw ? "Formatted" : "Raw"}
					</button>
				</div>
			}
		/>
	);
}
