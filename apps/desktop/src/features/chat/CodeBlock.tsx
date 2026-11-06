/**
 * @feature CHAT-06 Code block; CHAT-23 Run button on shell code blocks
 * Owns: A highlighted code block with a language label and a copy button. A shell block in a
 * workspace that can take changes also gets a Run button, its live output, a status mark, its exit
 * code, Stop command and Clear output.
 * Behaviour: ui-map.md 3.3 (code blocks with copy), inventory text R@8061041 (Run on shell blocks),
 * 8 (Shiki for highlight; CodeBlockMemoized).
 * Our design choice: Shell means bash, sh, shell, zsh, fish, ksh or dash. Run goes through
 * Actions.terminals.runCommand, which starts the block's text as a run terminal in the workspace.
 * The block shows the terminal's live stream as plain text with ANSI codes removed. Run is hidden
 * when the workspace is archived or not ready, and when the block is not a shell block.
 * Must handle: Unknown language (plain text); a very large block (cut off with 'Show all');
 * streaming code (re-highlight without flicker, memoised on the text); copy confirms with a short
 * 'Copied' label; horizontal scroll, no wrapping; an empty command (no Run action); a run that
 * fails (Failed with its exit code); a stopped run (Stopped); clearing the output.
 * Test first: Renders the code text for an unknown language and the copy button copies exactly that
 * text.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import { useCallback, useEffect, useState } from "react";
import { useActions, useTerminalConnection } from "../../core/hooks.ts";
import { CopyButton } from "../../ui/CopyButton.tsx";
import { CheckCircleIcon, CircleIcon, XCircleIcon } from "../../ui/icons.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useThemeType } from "../../ui/use-theme-type.ts";
import { stripAnsi } from "./tools/ToolCardFrame.tsx";

const LARGE_BLOCK = 4000;

const COMMAND_LANGUAGES = new Set(["bash", "sh", "shell", "zsh", "fish", "ksh", "dash"]);

function isShellLanguage(language: string | null): boolean {
	return language !== null && COMMAND_LANGUAGES.has(language.toLowerCase());
}

type RunStatus = "running" | "stopped" | "done" | "failed";

const STATUS_TEXT: Readonly<Record<RunStatus, string>> = {
	running: "Running",
	stopped: "Stopped",
	done: "Done",
	failed: "Failed",
};

/** Running until the terminal reports an end; a user's stop is named even when the signal has a code. */
function runStatus(ended: { exitCode: number | null } | null, stopped: boolean): RunStatus {
	if (ended === null) return "running";
	if (stopped) return "stopped";
	return ended.exitCode === 0 ? "done" : "failed";
}

function RunStatusIcon({ status }: { status: RunStatus }) {
	if (status === "running") return <Spinner size="sm" label="Running" />;
	if (status === "done") return <CheckCircleIcon className="size-3.5 text-success" />;
	if (status === "failed") return <XCircleIcon className="size-3.5 text-danger" />;
	return <CircleIcon className="size-3.5 text-fg-muted" />;
}

interface CommandRunViewProps {
	terminalId: TerminalId;
	onEnded: () => void;
}

/** The live output and controls of one command run. */
function CommandRunView({ terminalId, onEnded }: CommandRunViewProps) {
	const actions = useActions();
	const connection = useTerminalConnection(terminalId);
	const [output, setOutput] = useState("");
	const [ended, setEnded] = useState<{ exitCode: number | null } | null>(null);
	const [stopped, setStopped] = useState(false);
	const [stopping, setStopping] = useState(false);
	const source = connection.state === "ready" ? connection.data : null;

	useEffect(() => {
		if (source === null) return;
		const decoder = new TextDecoder();
		setEnded(source.ended);
		if (source.ended !== null) onEnded();
		const unsubscribeData = source.onData((chunk) => {
			const text = decoder.decode(chunk, { stream: true });
			setOutput((previous) => `${previous}${stripAnsi(text)}`);
		});
		const unsubscribeExit = source.onExit((exitCode) => {
			setEnded({ exitCode });
			onEnded();
		});
		return () => {
			unsubscribeData();
			unsubscribeExit();
		};
	}, [source, onEnded]);

	const status = runStatus(ended, stopped);
	const stop = async () => {
		setStopping(true);
		const result = await actions.terminals.close(terminalId);
		setStopping(false);
		if (!result.ok) {
			toastError("Couldn't stop the command", result.error);
			return;
		}
		setStopped(true);
	};

	if (connection.state === "error") {
		return (
			<p role="alert" className="border-t border-border px-3 py-1.5 text-xs text-danger">
				{connection.error.message}
			</p>
		);
	}

	return (
		<>
			<div
				data-run-status={status}
				className="flex items-center gap-2 border-t border-border px-3 py-1.5 text-xs text-fg-muted"
			>
				<RunStatusIcon status={status} />
				<span>{STATUS_TEXT[status]}</span>
				{ended !== null && ended.exitCode !== null ? (
					<span className="font-mono">Exit code {ended.exitCode}</span>
				) : null}
				<div className="ml-auto flex items-center gap-3">
					{status === "running" ? (
						<button
							type="button"
							onClick={() => void stop()}
							disabled={stopping}
							className="font-medium text-fg-muted hover:text-fg disabled:opacity-50"
						>
							Stop command
						</button>
					) : null}
					{output.length > 0 ? (
						<button
							type="button"
							onClick={() => setOutput("")}
							className="font-medium text-fg-muted hover:text-fg"
						>
							Clear output
						</button>
					) : null}
				</div>
			</div>
			{output.length > 0 ? (
				<div className="overflow-x-auto border-t border-border bg-canvas">
					<pre className="m-0 max-h-60 overflow-y-auto p-3 font-mono text-code text-fg">
						{output}
					</pre>
				</div>
			) : null}
		</>
	);
}

interface HighlightToken {
	content: string;
	color: string | undefined;
}

export interface CodeBlockProps {
	code: string;
	language: string | null;
	/** The workspace the command runs in. Without it the block has no Run button. */
	workspaceId?: WorkspaceId;
	/** The workspace is ready and not archived. */
	canRun?: boolean;
}

/** Highlighted tokens and the exact text they were made from. */
interface Highlighted {
	source: string;
	lines: HighlightToken[][];
}

export function CodeBlock({ code, language, workspaceId, canRun }: CodeBlockProps) {
	const actions = useActions();
	const theme = useThemeType();
	const [highlighted, setHighlighted] = useState<Highlighted | null>(null);
	const [showAll, setShowAll] = useState(false);
	const [run, setRun] = useState<{ terminalId: TerminalId } | null>(null);
	const [starting, setStarting] = useState(false);
	const [running, setRunning] = useState(false);
	const tooLarge = code.length > LARGE_BLOCK && !showAll;
	const shown = tooLarge ? code.slice(0, LARGE_BLOCK) : code;
	const runnable =
		canRun === true &&
		workspaceId !== undefined &&
		isShellLanguage(language) &&
		code.trim().length > 0;

	const endRun = useCallback(() => setRunning(false), []);

	const start = async () => {
		if (workspaceId === undefined) return;
		setStarting(true);
		const result = await actions.terminals.runCommand(workspaceId, code);
		setStarting(false);
		if (!result.ok) {
			toastError("Couldn't run the command", result.error);
			return;
		}
		setRun({ terminalId: result.value.id });
		setRunning(true);
	};

	useEffect(() => {
		let cancelled = false;
		if (language === null || language.length === 0) {
			setHighlighted(null);
			return;
		}
		const lang: string = language;
		async function highlight() {
			try {
				const { codeToTokens } = await import("shiki");
				const rendered = await codeToTokens(shown, {
					lang: lang as never,
					theme: theme === "dark" ? "github-dark" : "github-light",
				});
				if (!cancelled) {
					setHighlighted({
						source: shown,
						lines: rendered.tokens.map((line) =>
							line.map((token) => ({ content: token.content, color: token.color })),
						),
					});
				}
			} catch {
				// An unknown language or a failed load leaves the plain text, which is already on screen.
				if (!cancelled) setHighlighted(null);
			}
		}
		void highlight();
		return () => {
			cancelled = true;
		};
	}, [shown, language, theme]);

	// While a reply streams, the text grows after the last highlight. The old colours stay and the new tail
	// shows as plain text until the next highlight arrives, so the block never flashes back to plain.
	const known = highlighted !== null && shown.startsWith(highlighted.source) ? highlighted : null;
	const tail = known === null ? "" : shown.slice(known.source.length);
	let offset = 0;
	const coloured =
		known === null
			? null
			: known.lines.map((line, lineIndex) => {
					const cells = line.map((token) => {
						const key = `token-${offset}`;
						offset += token.content.length;
						return (
							<span
								key={key}
								style={token.color === undefined ? undefined : { color: token.color }}
							>
								{token.content}
							</span>
						);
					});
					const lineKey = `line-${offset}-${lineIndex}`;
					offset += 1;
					return (
						<span key={lineKey}>
							{cells}
							{lineIndex < known.lines.length - 1 ? "\n" : ""}
						</span>
					);
				});

	return (
		<div className="my-3 overflow-hidden rounded-lg border border-border bg-surface">
			<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
				<span className="font-mono text-2xs text-fg-muted">{language ?? "text"}</span>
				<div className="flex items-center gap-2">
					{runnable ? (
						<button
							type="button"
							onClick={() => void start()}
							disabled={starting || running}
							className="h-6 rounded-sm px-2 text-2xs font-medium text-fg-muted hover:bg-muted hover:text-fg disabled:opacity-50"
						>
							Run
						</button>
					) : null}
					<CopyButton
						text={code}
						onCopy={(text) => actions.app.copyText(text)}
						label="Copy"
						className="h-6 px-2 text-2xs"
					/>
				</div>
			</div>
			<div className="overflow-x-auto">
				<pre className="m-0 p-3 font-mono text-code text-fg">
					<code>
						{coloured ?? shown}
						{tail}
					</code>
				</pre>
			</div>
			{run !== null ? (
				<CommandRunView key={run.terminalId} terminalId={run.terminalId} onEnded={endRun} />
			) : null}
			{tooLarge ? (
				<div className="border-t border-border px-3 py-1.5">
					<button
						type="button"
						onClick={() => setShowAll(true)}
						className="text-xs font-medium text-link hover:underline"
					>
						Show all
					</button>
				</div>
			) : null}
		</div>
	);
}
