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
 * Codex draws Conductor's device-code steps (@10926386-@10934000): the personal or business plan
 * settings page, the OpenAI authorization page, the code and its copy button, and Restart. Claude
 * draws its paste form ("Paste code from Claude", "Paste here") and its setup-token command.
 * Test first: with a code the dialog shows a copy button, and when the install turns authenticated
 * it calls onOpenChange(false).
 */
import type { AgentKind } from "@conducted/shared";
import { type ReactNode, useEffect, useState } from "react";
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
	/** The program's own flow: Codex draws Conductor's device-code steps, Claude its paste form. */
	agent?: AgentKind;
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

/** Conductor's two settings pages for enabling Codex device authorization (renderApp @10921095). */
const CODEX_PERSONAL_SETTINGS =
	"https://chatgpt.com/#settings/Security:~:text=Enable%20device%20code%20authorization%20for%20Codex";
const CODEX_BUSINESS_SETTINGS =
	"https://chatgpt.com/admin/permissions#:~:text=authentication%20for%20Codex%20CLI";
/** OpenAI's device authorization page, when the flow does not name one. */
const CODEX_DEVICE_PAGE = "https://auth.openai.com/codex/device";

export function AgentLoginDialog({
	open,
	agentName,
	agent,
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
	const [plan, setPlan] = useState<"personal" | "business">("personal");

	useEffect(() => {
		if (open && signedIn) onOpenChange(false);
	}, [open, signedIn, onOpenChange]);

	const submit = () => {
		if (finishing) return;
		if (requiresCode && code.trim() === "") return;
		onFinish?.(requiresCode ? code.trim() : undefined);
	};

	const openTarget = flow?.url ?? flow?.verificationUrl;
	const isCodex = agent === "codex";
	const verificationUrl = flow?.verificationUrl ?? CODEX_DEVICE_PAGE;
	const settingsUrl = plan === "business" ? CODEX_BUSINESS_SETTINGS : CODEX_PERSONAL_SETTINGS;

	const deviceStep = (
		index: number,
		title: string,
		action: { label: string; url: string } | null,
		body?: ReactNode,
	) => (
		<li className="flex gap-2 text-sm">
			<span className="text-fg-muted">{index}.</span>
			<div className="min-w-0 space-y-2">
				<p>{title}</p>
				{action === null ? null : (
					<Button variant="outline" size="sm" onClick={() => onOpenUrl(action.url)}>
						{action.label}
					</Button>
				)}
				{body}
			</div>
		</li>
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title={isCodex ? "Sign in to Codex" : `Sign in to ${agentName}`}
				description={isCodex ? null : flow?.instructions}
				onConfirm={!isCodex && requiresCode ? submit : undefined}
			>
				<div className="flex flex-col gap-4">
					{error ? (
						<p role="alert" className="text-sm text-danger">
							{error}
						</p>
					) : null}

					{isCodex ? (
						<>
							<p className="text-sm text-fg-muted">
								Authorize Conducted to use your ChatGPT subscription.
							</p>
							<div className="flex flex-wrap items-center gap-2">
								<Button
									type="button"
									size="sm"
									variant={plan === "personal" ? "secondary" : "outline"}
									onClick={() => setPlan("personal")}
								>
									Personal plan
								</Button>
								<Button
									type="button"
									size="sm"
									variant={plan === "business" ? "secondary" : "outline"}
									onClick={() => setPlan("business")}
								>
									Business plan
								</Button>
							</div>
							<ol className="flex flex-col gap-4">
								{deviceStep(1, "Enable device code authorization for Codex.", {
									label:
										plan === "business" ? "Open ChatGPT admin settings" : "Open ChatGPT settings",
									url: settingsUrl,
								})}
								{deviceStep(2, "Open the OpenAI device authorization page.", {
									label: "Open device authorization",
									url: verificationUrl,
								})}
								{deviceStep(
									3,
									"Enter this code when OpenAI asks for it:",
									null,
									flow?.code === undefined ? (
										<div className="flex items-center gap-2 text-sm text-fg-muted">
											<Spinner size="sm" label="Starting device code authorization" />
											Starting device code authorization...
										</div>
									) : (
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => onCopy?.(flow.code ?? "")}
												className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-sm tracking-wider hover:bg-hover"
											>
												{flow.code}
											</button>
											<Button
												size="xs"
												variant="ghost"
												aria-label="Copy Codex verification code"
												onClick={() => onCopy?.(flow.code ?? "")}
											>
												Copy
											</Button>
										</div>
									),
								)}
							</ol>
							{finishing ? (
								<div className="flex items-center gap-2 text-sm text-fg-muted">
									<Spinner size="sm" label="Waiting for approval" />
									Waiting for approval—keep this dialog open.
								</div>
							) : null}
							<div>
								<Button variant="outline" size="sm" onClick={onRetry}>
									Restart device authorization
								</Button>
							</div>
						</>
					) : (
						<>
							{openTarget ? (
								<div>
									<Button variant="secondary" onClick={() => onOpenUrl(openTarget)}>
										{error === null && flow !== null ? "Open browser again" : "Open browser"}
									</Button>
								</div>
							) : null}

							{flow?.command && !flow.code ? (
								<div className="flex flex-col gap-1">
									<p className="text-sm text-fg-muted">
										Run <code className="font-mono">claude setup-token</code> in a terminal and
										paste the token you get back here.
									</p>
									<div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
										<code className="min-w-0 flex-1 font-mono text-sm text-fg">{flow.command}</code>
										<Button
											aria-label="Copy command"
											title="Copy command"
											size="xs"
											variant="secondary"
											onClick={() => onCopy?.(flow.command ?? "")}
										>
											Copy command
										</Button>
									</div>
								</div>
							) : null}

							{requiresCode ? (
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="agent-login-code">Paste code from Claude</Label>
									<Input
										id="agent-login-code"
										value={code}
										autoFocus
										placeholder="Paste here"
										onChange={(event) => setCode(event.target.value)}
									/>
								</div>
							) : null}

							{finishing ? (
								<div className="flex items-center gap-2 text-sm text-fg-muted">
									<Spinner size="sm" label="Waiting for sign-in" />
									Waiting for sign-in...
								</div>
							) : null}
						</>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					{!isCodex && requiresCode ? (
						<Button
							variant="default"
							loading={finishing}
							disabled={code.trim() === ""}
							onClick={submit}
						>
							Connect
						</Button>
					) : null}
					{!isCodex && (error !== null || flow === null) ? (
						<Button variant={flow === null ? "default" : "secondary"} onClick={onRetry}>
							Retry
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
