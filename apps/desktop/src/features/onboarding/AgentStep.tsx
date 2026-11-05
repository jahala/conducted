/**
 * @feature APP-02 Onboarding: agents
 * Owns: the step that lists Claude Code, Codex, Cursor, OpenCode and Pi with whether each is
 * installed, its version, and whether it is signed in; it also starts an agent's sign-in flow.
 * Behaviour: ui-map.md 6 (install status, versions, sign-in), 7.1 (the agents step), other-runners.md 5
 * (agent detection and sign-in flows).
 * Our design choice: the list comes from the agent catalogue's install check. Installing and updating
 * programs belongs to PLAT-28 and is not built, so a missing program shows how to install it instead.
 * Must handle: detection still running (a spinner per row); an agent installed but not signed in
 * (Sign in, then its instructions, code or link); none installed (instructions and Refresh); detection
 * fails (message and Retry); the version when it is known.
 * Test first: A signed-in Claude and a missing Codex render one 'Ready' row and one 'Not installed'
 * row.
 */
import type { AgentInstall, AgentLogin } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { useActions, useAgentInstalls } from "../../core/hooks.ts";
import { agentDisplayName, agentKey } from "../../core/services/agent-catalog.ts";
import { Alert, AlertDescription } from "../../ui/Alert.tsx";
import { Badge, type BadgeTone } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Spinner } from "../../ui/Spinner.tsx";

interface AgentSelection {
	agent: AgentKind;
	acpAgent?: AcpAgent;
}

interface LoginState extends AgentSelection {
	key: string;
	name: string;
	loginId: string | null;
	flow: AgentLogin | null;
	error: string | null;
	finishing: boolean;
	requiresCode: boolean;
}

/** The five programs the step names, in Conductor's order (ui-map.md 6). */
const AGENT_PROGRAMS: AgentSelection[] = [
	{ agent: "claude" },
	{ agent: "codex" },
	{ agent: "cursor" },
	{ agent: "acp", acpAgent: "opencode" },
	{ agent: "acp", acpAgent: "pi" },
];

function installOf(installs: AgentInstall[], selection: AgentSelection): AgentInstall | undefined {
	const key = agentKey(selection.agent, selection.acpAgent);
	return installs.find((install) => agentKey(install.agent, install.acpAgent) === key);
}

function rowState(install: AgentInstall | undefined): { label: string; tone: BadgeTone } {
	if (install === undefined || !install.installed)
		return { label: "Not installed", tone: "neutral" };
	if (install.authenticated === true) return { label: "Ready", tone: "success" };
	if (install.authenticated === false) return { label: "Not signed in", tone: "warning" };
	return { label: "Installed", tone: "neutral" };
}

/** One row while detection runs: the name is known, the answer is not. */
function CheckingRow({ name }: { name: string }) {
	return (
		<li aria-label={name} className="flex items-center gap-2 rounded-md border border-border p-3">
			<Spinner size="sm" label={`Checking ${name}`} />
			<span className="text-sm text-fg-muted">{name}</span>
		</li>
	);
}

export function AgentStep() {
	const actions = useActions();
	const installs = useAgentInstalls();
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [login, setLogin] = useState<LoginState | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [code, setCode] = useState("");
	/** The newest sign-in start. An older answer never replaces the panel it opened. */
	const loginRequest = useRef(0);
	const loginRef = useRef<LoginState | null>(null);
	loginRef.current = login;

	const refresh = async () => {
		const result = await actions.agents.refresh();
		if (result.ok) setNotice(null);
		else setNotice(result.error.message);
	};

	useEffect(() => {
		let cancelled = false;
		void actions.agents.refresh().then((result) => {
			if (!cancelled && !result.ok) setNotice(result.error.message);
		});
		return () => {
			cancelled = true;
		};
	}, [actions]);

	const finishLogin = async (loginId: string, pastedCode?: string) => {
		setLogin((current) =>
			current?.loginId === loginId ? { ...current, finishing: true, error: null } : current,
		);
		const finished = await actions.agents.finishLogin(loginId, pastedCode);
		if (!finished.ok) {
			setLogin((current) =>
				current?.loginId === loginId
					? { ...current, finishing: false, error: finished.error.message }
					: current,
			);
			return;
		}
		if (finished.value.outcome !== "signed_in") {
			setLogin((current) =>
				current?.loginId === loginId
					? {
							...current,
							finishing: false,
							error: finished.value.message ?? "The sign-in did not finish.",
						}
					: current,
			);
			return;
		}
		const current = loginRef.current;
		const wasShowingThisLogin = current === null || current.loginId === loginId;
		setLogin((shown) => (shown === null || shown.loginId === loginId ? null : shown));
		if (wasShowingThisLogin) setCode("");
		const refreshed = await actions.agents.refresh();
		if (!refreshed.ok) setNotice(refreshed.error.message);
	};

	const startLogin = async (selection: AgentSelection) => {
		const key = agentKey(selection.agent, selection.acpAgent);
		const name = agentDisplayName(selection);
		const request = ++loginRequest.current;
		setBusyKey(key);
		setNotice(null);
		setCopied(null);
		const started = await actions.agents.login(selection.agent, selection.acpAgent);
		if (request !== loginRequest.current) return;
		setBusyKey(null);
		if (!started.ok) {
			setLogin({
				...selection,
				key,
				name,
				loginId: null,
				flow: null,
				error: started.error.message,
				finishing: false,
				requiresCode: false,
			});
			return;
		}
		const requiresCode = selection.agent === "claude";
		setLogin({
			...selection,
			key,
			name,
			loginId: started.value.loginId,
			flow: started.value,
			error: null,
			finishing: false,
			requiresCode,
		});
		if (selection.agent === "codex" || selection.agent === "cursor") {
			void finishLogin(started.value.loginId);
		}
	};

	const cancelLogin = async (loginId: string) => {
		setLogin(null);
		setCode("");
		const cancelled = await actions.agents.cancelLogin(loginId);
		if (!cancelled.ok) {
			setNotice(cancelled.error.message);
			return;
		}
		await refresh();
	};

	const openUrl = async (url: string, loginId: string | null) => {
		const opened = await actions.app.openUrl(url);
		if (!opened.ok) {
			setLogin((current) =>
				current?.loginId === loginId ? { ...current, error: opened.error.message } : current,
			);
		}
	};

	const copy = async (text: string, loginId: string | null) => {
		const result = await actions.app.copyText(text);
		if (!result.ok) {
			setLogin((current) =>
				current?.loginId === loginId ? { ...current, error: result.error.message } : current,
			);
			return;
		}
		setCopied(text);
	};

	return (
		<div className="flex flex-col gap-3">
			{notice ? (
				<Alert tone="destructive">
					<AlertDescription>{notice}</AlertDescription>
				</Alert>
			) : null}
			<LoadableView
				value={installs}
				loadingLabel="Checking agent programs"
				errorTitle="Couldn't check the agent programs"
				onRetry={() => void refresh()}
				loading={
					<ul aria-label="Agent programs" className="flex flex-col gap-2">
						{AGENT_PROGRAMS.map((selection) => (
							<CheckingRow
								key={agentKey(selection.agent, selection.acpAgent)}
								name={agentDisplayName(selection)}
							/>
						))}
					</ul>
				}
			>
				{(found) => {
					const anyInstalled = AGENT_PROGRAMS.some(
						(selection) => installOf(found, selection)?.installed === true,
					);
					return (
						<div className="flex flex-col gap-3">
							{!anyInstalled ? (
								<p className="text-sm text-fg-muted">
									No agent programs were found. Install one on this Mac, then choose Refresh. You
									can also continue and set one up later in Settings.
								</p>
							) : null}
							<ul aria-label="Agent programs" className="flex flex-col gap-2">
								{AGENT_PROGRAMS.map((selection) => {
									const key = agentKey(selection.agent, selection.acpAgent);
									const name = agentDisplayName(selection);
									const install = installOf(found, selection);
									const state = rowState(install);
									const selectedLogin = login?.key === key ? login : null;
									const flow = selectedLogin?.flow ?? null;
									const openTarget = flow?.url ?? flow?.verificationUrl ?? null;
									const userCode = flow?.userCode ?? null;
									const command = flow?.command ?? null;
									return (
										<li
											key={key}
											aria-label={name}
											className="flex flex-col gap-3 rounded-md border border-border bg-raised p-3"
										>
											<div className="flex items-start justify-between gap-3">
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-2">
														<span className="text-sm font-medium text-fg">{name}</span>
														<Badge tone={state.tone}>{state.label}</Badge>
													</div>
													{install?.installed ? (
														<p className="mt-1 text-xs text-fg-muted">
															{install.version === undefined
																? "Version unknown"
																: `Version ${install.version}`}
														</p>
													) : (
														<p className="mt-1 text-xs text-fg-muted">
															{install?.warning ?? `Install ${name} on this Mac.`}
														</p>
													)}
												</div>
												{install?.installed && install.authenticated !== true ? (
													<Button
														size="sm"
														variant="secondary"
														loading={busyKey === key}
														onClick={() => void startLogin(selection)}
													>
														Sign in
													</Button>
												) : null}
											</div>

											{selectedLogin ? (
												<div className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3 text-sm">
													{flow ? <p className="text-fg-muted">{flow.instructions}</p> : null}
													{selectedLogin.error ? (
														<p role="alert" className="text-danger">
															{selectedLogin.error}
														</p>
													) : null}
													{openTarget !== null ? (
														<Button
															size="sm"
															variant="secondary"
															onClick={() => void openUrl(openTarget, selectedLogin.loginId)}
														>
															Open browser
														</Button>
													) : null}
													{userCode !== null ? (
														<div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
															<code className="min-w-0 flex-1 font-mono text-sm text-fg">
																{userCode}
															</code>
															<Button
																size="xs"
																variant="secondary"
																onClick={() => void copy(userCode, selectedLogin.loginId)}
															>
																Copy code
															</Button>
														</div>
													) : null}
													{command !== null && userCode === null ? (
														<div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
															<code className="min-w-0 flex-1 font-mono text-sm text-fg">
																{command}
															</code>
															<Button
																size="xs"
																variant="secondary"
																onClick={() => void copy(command, selectedLogin.loginId)}
															>
																Copy command
															</Button>
														</div>
													) : null}
													{copied ? <p className="text-xs text-fg-muted">Copied</p> : null}
													{selectedLogin.requiresCode ? (
														<div className="flex items-end gap-2">
															<Input
																aria-label={`Code from ${selectedLogin.name}`}
																placeholder="Paste the code"
																value={code}
																onChange={(event) => setCode(event.target.value)}
															/>
															<Button
																size="sm"
																loading={selectedLogin.finishing}
																disabled={code.trim() === ""}
																onClick={() => {
																	if (selectedLogin.loginId !== null) {
																		void finishLogin(selectedLogin.loginId, code.trim());
																	}
																}}
															>
																Finish sign-in
															</Button>
														</div>
													) : null}
													{selectedLogin.finishing ? (
														<div className="flex items-center gap-2 text-fg-muted">
															<Spinner size="sm" label="Waiting for sign-in" />
															Waiting for sign-in…
														</div>
													) : null}
													<div className="flex items-center gap-2">
														{selectedLogin.flow !== null &&
														!selectedLogin.requiresCode &&
														!selectedLogin.finishing ? (
															<Button size="sm" variant="secondary" onClick={() => void refresh()}>
																Check again
															</Button>
														) : null}
														<Button
															size="sm"
															variant="ghost"
															onClick={() => {
																if (selectedLogin.loginId === null) {
																	void startLogin(selection);
																} else {
																	void cancelLogin(selectedLogin.loginId);
																}
															}}
														>
															{selectedLogin.loginId === null ? "Retry" : "Cancel"}
														</Button>
													</div>
												</div>
											) : null}
										</li>
									);
								})}
							</ul>
							{!anyInstalled ? (
								<div>
									<Button size="sm" variant="secondary" onClick={() => void refresh()}>
										Refresh
									</Button>
								</div>
							) : null}
						</div>
					);
				}}
			</LoadableView>
		</div>
	);
}
