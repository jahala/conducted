/**
 * @feature CLOUD-14 Cloud agents ask to run commands on the Mac
 * Owns: the RunLocalCommand tool: a cloud agent asks the app to run a one-shot shell command on
 * the Mac that created the cloud workspace.
 * Behaviour: research/conductor/claude-runner.md section 4.2: the command, a description, a
 * reason, a working folder and a timeout up to 30 minutes with a reason. The user approves each
 * command unless they allowed local commands; the app runs it and returns the exit code and text.
 * Offered only for a cloud chat whose config has `appTools.localExecution` on.
 * Must handle: a refusal or a command that could not start (an error result with the app's
 * message), a command that took too long, and output too long for the result (the app saves it in
 * the workspace and the result points there).
 * Our design choice: the tool never runs anything itself and never reads a file. It asks the app,
 * which owns the approval and the Mac's shell, so the sidecar inside a sandbox cannot reach the
 * Mac's files.
 * Test first: execute() without a timeout asks the app for the 60 second default.
 */
import { localCommandTimeoutMs } from "@conducted/protocol";
import { z } from "zod";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.ts";

export const runLocalCommandShape = {
	command: z.string().min(1).describe("The shell command to run on the user's Mac."),
	description: z.string().optional().describe("A short description of what the command does."),
	reason: z.string().optional().describe("Why the command must run on the user's Mac."),
	cwd: z
		.string()
		.optional()
		.describe("The folder on the user's Mac to run in. Defaults to their home folder."),
	timeoutMs: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("How long the command may run, up to 120000 ms, or 30 minutes with a reason."),
	extendedTimeoutReason: z
		.string()
		.optional()
		.describe("Why the command needs more than 120000 ms."),
};

/** The tool result for one answer from the app. */
function resultText(value: {
	code?: number;
	stdout?: string;
	stderr?: string;
	outputPath?: string;
	stdoutTruncated?: boolean;
	stderrTruncated?: boolean;
	timedOut?: boolean;
	denied?: boolean;
	error?: string;
}): ToolResult {
	if (value.denied === true) {
		return { text: value.error ?? "The user denied the local command.", isError: true };
	}
	if (value.timedOut === true) {
		return { text: value.error ?? "The command timed out.", isError: true };
	}
	if (value.error !== undefined) return { text: value.error, isError: true };
	const parts: string[] = [];
	if (value.stdout !== undefined && value.stdout.length > 0) parts.push(value.stdout);
	if (value.stderr !== undefined && value.stderr.length > 0) {
		parts.push(`Standard error:\n${value.stderr}`);
	}
	if (value.outputPath !== undefined) {
		parts.push(`The output was long; the whole of it is saved at ${value.outputPath}.`);
	} else if (value.stdoutTruncated === true || value.stderrTruncated === true) {
		parts.push("The output was cut because it was too long.");
	}
	parts.push(`Exit code: ${value.code ?? 0}.`);
	return { text: parts.join("\n\n"), isError: false };
}

export const runLocalCommandTool: ToolDefinition<typeof runLocalCommandShape> = {
	name: "RunLocalCommand",
	description:
		"Run a one-shot shell command on the Mac that created this cloud workspace, for work that needs something only that Mac has. The user must approve the command unless they have allowed local commands. Commands may run for 60 seconds by default and up to 120 seconds; set timeoutMs and extendedTimeoutReason to ask for up to 30 minutes. The answer carries the exit code and the command's text, and points to a file in the workspace when the output is long.",
	inputShape: runLocalCommandShape,
	readOnly: false,
	idempotent: false,
	enabledBy: "localExecution",
	async execute(
		args: z.infer<z.ZodObject<typeof runLocalCommandShape>>,
		context: ToolContext,
	): Promise<ToolResult> {
		const result = await context.backend.runLocalCommand(context.sessionId, {
			command: args.command,
			...(args.description === undefined ? {} : { description: args.description }),
			...(args.reason === undefined ? {} : { reason: args.reason }),
			...(args.cwd === undefined ? {} : { cwd: args.cwd }),
			timeoutMs: localCommandTimeoutMs(args),
			...(args.extendedTimeoutReason === undefined
				? {}
				: { extendedTimeoutReason: args.extendedTimeoutReason }),
		});
		if (!result.ok) return { text: result.error.message, isError: true };
		return resultText(result.value);
	},
};
