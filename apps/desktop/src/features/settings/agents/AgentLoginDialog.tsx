/**
 * @feature SET-03 Agent sign-in dialog
 * Owns: the dialog shown while an agent's own sign-in runs. It shows the instructions, a link to
 * open, a code to copy or a terminal command (such as `claude setup-token`) when the flow has one,
 * and waits for the sign-in to finish.
 * Behaviour: ui-map.md 6, "Agents page" (CLI sign-in, device-code flow for Codex); rpc
 * startAgentLogin returns { loginId, url?, userCode?, verificationUrl?, command?, instructions },
 * then finishAgentLogin or cancelAgentLogin (packages/protocol rpc.ts).
 * Must handle: no url and no code (instructions only), the user closing the dialog mid-flow
 * (agents.cancelLogin, and the card refreshes), a timeout (Retry; Codex waits up to 10 minutes),
 * the sign-in finishing (the parent calls agents.finishLogin, then the dialog closes by itself
 * once the install turns authenticated), a code that must be copied exactly, and the request
 * failing (error text, Retry).
 * Test first: with a code the dialog shows a copy button, and when the install turns authenticated
 * it calls onOpenChange(false).
 */
import { useEffect, useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";

export interface AgentLoginFlow {
	/** A page to open in the browser. */
	url?: string;
	/** A code the user types on the verification page (device-code sign-in). */
	code?: string;
	/** Where to type the code, when the flow gives one. */
	verificationUrl?: string;
	/** A terminal command the user can run instead, such as `claude setup-token`. */
	command?: string;
	instructions: string;
}

export interface AgentLoginDialogProps {
	open: boolean;
	agentName: string;
	flow: AgentLoginFlow | null;
	error: string | null;
	/** The install turned authenticated after the flow finished. */
	signedIn?: boolean;
	/** The parent is waiting for the agent to report the finished sign-in. */
	finishing?: boolean;
	/** The flow needs a code pasted from the agent's own browser page. */
	requiresCode?: boolean;
	onOpenUrl: (url: string) => void;
	onOpenChange: (open: boolean) => void;
	onRetry: () => void;
	/** Called with the pasted code, or with no code when the flow finishes itself. */
	onFinish?: (code?: string) => void;
	/** Copies a code or command exactly. */
	onCopy?: (text: string) => void;
}

export function AgentLoginDialog({
	open,
	agentName,
	flow,
	error,
	signedIn = false,
	finishing = false,
	requiresCode = false,
	onOpenUrl,
	onOpenChange,
	onRetry,
	onFinish,
	onCopy,
}: AgentLoginDialogProps) {
	const [code, setCode] = useState("");

	useEffect(() => {
		if (open && signedIn) onOpenChange(false);
	}, [open, signedIn, onOpenChange]);

	const submit = () => {
		if (finishing) return;
		if (requiresCode && code.trim() === "") return;
		onFinish?.(requiresCode ? code.trim() : undefined);
	};

	const openTarget = flow?.url ?? flow?.verificationUrl;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title={`Sign in to ${agentName}`}
				description={flow?.instructions}
				onConfirm={requiresCode ? submit : undefined}
			>
				<div className="flex flex-col gap-4">
					{error ? (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					) : null}

					{openTarget ? (
						<div>
							<Button variant="secondary" onClick={() => onOpenUrl(openTarget)}>
								Open browser
							</Button>
						</div>
					) : null}

					{flow?.code ? (
						<div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
							<code className="min-w-0 flex-1 font-mono text-sm text-fg">{flow.code}</code>
							<Button
								size="xs"
								variant="secondary"
								aria-label="Copy Codex verification code"
								onClick={() => onCopy?.(flow.code ?? "")}
							>
								Copy code
							</Button>
						</div>
					) : null}

					{flow?.command && !flow.code ? (
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium text-fg">Run this command instead</p>
							<div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
								<code className="min-w-0 flex-1 font-mono text-sm text-fg">{flow.command}</code>
								<Button size="xs" variant="secondary" onClick={() => onCopy?.(flow.command ?? "")}>
									Copy command
								</Button>
							</div>
						</div>
					) : null}

					{requiresCode ? (
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="agent-login-code">
								{agentName === "Claude Code"
									? "Paste code from Claude"
									: `Paste code from ${agentName}`}
							</Label>
							<Input
								id="agent-login-code"
								value={code}
								autoFocus
								placeholder="Paste the code"
								onChange={(event) => setCode(event.target.value)}
							/>
						</div>
					) : null}

					{finishing ? (
						<div className="flex items-center gap-2 text-sm text-fg-muted">
							<Spinner size="sm" label="Waiting for sign-in" />
							Waiting for sign-in…
						</div>
					) : null}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					{requiresCode ? (
						<Button
							variant="default"
							loading={finishing}
							disabled={code.trim() === ""}
							onClick={submit}
						>
							Finish sign-in
						</Button>
					) : null}
					{error !== null || flow === null ? (
						<Button variant={flow === null ? "default" : "secondary"} onClick={onRetry}>
							Retry
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
