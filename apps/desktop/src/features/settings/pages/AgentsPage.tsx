/**
 * @feature SET-03 Agents settings page
 * @feature SET-12 Claude settings and Codex config editors, Claude in Chrome switch
 * Owns: the Agents page of Settings: for each agent program, whether it is installed, its version
 * and path, whether it is signed in, and the sign-in action. Also the Claude in Chrome switch and
 * the way into each agent's own config editor (SET-12).
 * Behaviour: ui-map.md 6, "Agents" table and "Agents page" (provider search, one card per
 * provider: Claude Code, Codex, Cursor, OpenCode and Pi; states "Loaded from env", "API key
 * configured", "Validation failed"; "Claude settings JSON", "Codex config" and
 * "Use Claude Code with Chrome"). Programs are downloaded, updated and removed by the program
 * manager (PLAT-28, D021), not by this page.
 * Data: useAgentInstalls() (AgentInstall: agent, acpAgent, installed, path, version,
 * authenticated), useActions().agents (login, finishLogin, cancelLogin, refresh), and the
 * chrome_mode_enabled setting.
 * Children: agents/AgentCard, agents/AgentLoginDialog, agents/AgentProvidersDialog,
 * agents/AgentConfigDialog, and the MCP servers region (SET-05: agents/McpServersSection.tsx).
 * Other owners: the Advanced program paths are SET-02 with the path keys in SIDE-21.
 * Measured from Conductor 0.92.1 (the owner's capture of Settings > Agents): the page title, then one
 * underlined tab per agent (Claude Code, Codex, Cursor, OpenCode), and under it the chosen agent's panel
 * (agents/AgentCard). "Use Claude Code with Chrome" sits in Claude Code's panel under a rule.
 * Conductor's tabs carry each agent's logo (renderApp v_e); the app ships no agent logos, so the tabs
 * are text only. Refresh waits for the check, and a failed check is a toast.
 * Our design choice: "Search providers" filters the tabs and sits at the right of the tab row; the MCP
 * servers region stays under the panel. Conductor's "Claude Code executable path" is our Advanced page's
 * program path (SET-02); the capture also shows it in the agent's panel, which needs a way for this
 * page to check a path (a new hook or action, listed in docs/reports/parity-gaps-2026-11-07.md).
 * Must handle: a retry after a failed sign-in (the first one is cancelled first), loading and error, a provider filter with no match ("No providers match your
 * search."), nothing installed (the page leads with install help), a program found but failing its
 * version check ("Validation failed" with its warning), a sign-in in progress, a finished sign-in
 * that toasts Conductor's success sentence and restarts the agent's idle chats, and a refresh after
 * the user installs a program in a terminal.
 * Test first: with Codex not installed its card shows install help and no sign-in button.
 */
import type { AgentInstall } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { useEffect, useRef, useState } from "react";
import { agentDisplayName, agentKey } from "../../../core/agent-catalog.ts";
import { useServices } from "../../../core/context.tsx";
import { useActions, useAgentInstalls } from "../../../core/hooks.ts";
import {
	agentLoginSuccessMessage,
	restartIdleAgentChats,
} from "../../../core/use-agent-login.ts";
import { Button } from "../../../ui/Button.tsx";
import { EmptyState } from "../../../ui/EmptyState.tsx";
import { Input } from "../../../ui/Input.tsx";
import { LoadableView } from "../../../ui/LoadableView.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/Tabs.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { AgentCard } from "../agents/AgentCard.tsx";
import { AgentConfigDialog } from "../agents/AgentConfigDialog.tsx";
import { AgentLoginDialog, type AgentLoginFlow } from "../agents/AgentLoginDialog.tsx";
import { AgentProvidersDialog } from "../agents/AgentProvidersDialog.tsx";
import { McpServersPanel } from "../agents/McpServersSection.tsx";
import { RegistrySettingRowByKey } from "../SettingRow.tsx";

interface AgentSelector {
	agent: AgentKind;
	acpAgent?: AcpAgent;
}

interface LoginState extends AgentSelector {
	name: string;
	loginId: string | null;
	flow: AgentLoginFlow | null;
	error: string | null;
	finishing: boolean;
	requiresCode: boolean;
}

const KNOWN_ORDER: Record<string, number> = {
	claude: 0,
	codex: 1,
	cursor: 2,
	"acp:opencode": 3,
	"acp:pi": 4,
};

const orderOf = (install: AgentInstall): number =>
	KNOWN_ORDER[agentKey(install.agent, install.acpAgent)] ?? 100;

/** One program's sign-in ends with a code pasted back, not a browser wait. */
const needsPastedCode = (agent: AgentKind): boolean => agent === "claude";

export function AgentsPage() {
	const value = useAgentInstalls();
	const actions = useActions();
	const services = useServices();
	const [query, setQuery] = useState("");
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [login, setLogin] = useState<LoginState | null>(null);
	const [providers, setProviders] = useState<AgentInstall | null>(null);
	const [configAgent, setConfigAgent] = useState<"claude" | "codex" | null>(null);
	const [tab, setTab] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const announced = useRef<string | null>(null);

	useEffect(() => {
		void actions.agents.refresh();
	}, [actions]);

	const installs = value.state === "ready" ? value.data : [];
	const loginInstall =
		login === null
			? undefined
			: installs.find(
					(install) => install.agent === login.agent && install.acpAgent === login.acpAgent,
				);
	const signedIn = loginInstall?.authenticated === true;

	useEffect(() => {
		if (!login || !signedIn || loginInstall?.authMethod !== "chatgpt") return;
		const id = login.loginId ?? "codex";
		if (announced.current === id) return;
		announced.current = id;
		toast("Codex now uses your ChatGPT plan");
	}, [login, signedIn, loginInstall?.authMethod]);

	/** Conductor's Refresh: the icon spins and the button waits until the check settles. */
	const refresh = async () => {
		setRefreshing(true);
		const result = await actions.agents.refresh();
		setRefreshing(false);
		if (!result.ok) toastError("Couldn't refresh the agents", result.error);
	};

	const copy = async (text: string, message: string) => {
		const result = await actions.app.copyText(text);
		if (!result.ok) {
			toastError("Couldn't copy to the clipboard", result.error);
			return;
		}
		toast(message);
	};

	const startLogin = async (selector: AgentSelector) => {
		setBusyKey(agentKey(selector.agent, selector.acpAgent));
		const started = await actions.agents.login(selector.agent, selector.acpAgent);
		setBusyKey(null);
		const name = agentDisplayName(selector);
		if (!started.ok) {
			setLogin({
				...selector,
				name,
				loginId: null,
				flow: null,
				error: started.error.message,
				finishing: false,
				requiresCode: false,
			});
			return;
		}
		setLogin({
			...selector,
			name,
			loginId: started.value.loginId,
			flow: {
				url: started.value.url,
				code: started.value.userCode,
				verificationUrl: started.value.verificationUrl,
				command: started.value.command,
				instructions: started.value.instructions,
			},
			error: null,
			finishing: false,
			requiresCode: needsPastedCode(selector.agent),
		});
		if (selector.agent === "codex" || selector.agent === "cursor") {
			void finishLogin(started.value.loginId, undefined, selector);
		}
	};

	const finishLogin = async (loginId: string, code?: string, selection?: AgentSelector) => {
		setLogin((current) =>
			current?.loginId === loginId ? { ...current, finishing: true, error: null } : current,
		);
		const finished = await actions.agents.finishLogin(loginId, code);
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
		// The login is finished: clear its id before the install refresh so the dialog's
		// automatic close cannot ask the sidecar to cancel a sign-in that already succeeded.
		setLogin((current) =>
			current?.loginId === loginId
				? { ...current, loginId: null, finishing: false, error: null }
				: current,
		);
		const refreshed = await actions.agents.refresh();
		if (!refreshed.ok) toastError("Couldn't check the sign-in", refreshed.error);
		if (selection !== undefined) {
			// Conductor's success sentence, then its idle chats restart so they pick up the login.
			const restart = await restartIdleAgentChats(services.services, actions, selection);
			toast.success(agentLoginSuccessMessage(selection, restart));
		}
	};

	const closeLogin = (open: boolean) => {
		if (open) return;
		const current = login;
		setLogin(null);
		if (current?.loginId !== null && current?.loginId !== undefined) {
			void actions.agents.cancelLogin(current.loginId).then((result) => {
				if (!result.ok) toastError("Couldn't cancel the sign-in", result.error);
			});
		}
		void actions.agents.refresh();
	};

	const retryLogin = async () => {
		if (login === null) return;
		const { agent, acpAgent, loginId } = login;
		// A failed finish leaves the first sign-in open in the sidecar: end it before starting another.
		if (loginId !== null) {
			const cancelled = await actions.agents.cancelLogin(loginId);
			if (!cancelled.ok) toastError("Couldn't cancel the earlier sign-in", cancelled.error);
		}
		await startLogin({ agent, acpAgent });
	};

	const openUrl = (url: string) => {
		void actions.app.openUrl(url).then((result) => {
			if (!result.ok) toastError("Couldn't open the browser", result.error);
		});
	};

	return (
		<div className="flex flex-col gap-8">
			<h1 className="text-2xl font-medium text-fg">Agents</h1>

			<LoadableView
				value={value}
				loadingLabel="Loading agents"
				errorTitle="Couldn't load agents"
				onRetry={() => void actions.agents.refresh()}
				loading={
					<div className="flex flex-col gap-3">
						{[0, 1, 2].map((index) => (
							<Skeleton key={index} className="h-28 w-full" />
						))}
					</div>
				}
			>
				{(agents) => {
					const needle = query.trim().toLowerCase();
					const filtered = [...agents]
						.sort((left, right) => orderOf(left) - orderOf(right))
						.filter((install) =>
							needle === "" ? true : agentDisplayName(install).toLowerCase().includes(needle),
						);

					const searchBox = (
						<div className="ml-auto flex shrink-0 items-center pb-1">
							<Input
								type="search"
								aria-label="Search providers"
								placeholder="Search providers"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								className="h-7 w-44"
							/>
						</div>
					);

					const anyInstalled = agents.some((install) => install.installed);
					const keys = filtered.map((install) => agentKey(install.agent, install.acpAgent));
					const active = tab !== null && keys.includes(tab) ? tab : (keys[0] ?? "");
					return (
						<Tabs value={active} onValueChange={setTab} className="flex flex-col gap-6">
							<div className="flex items-end gap-4 border-b border-separator">
								<TabsList aria-label="Agents" className="gap-6 border-b-0 px-0">
									{filtered.map((install) => (
										<TabsTrigger
											key={agentKey(install.agent, install.acpAgent)}
											value={agentKey(install.agent, install.acpAgent)}
											className="px-0! font-normal"
										>
											{agentDisplayName(install)}
										</TabsTrigger>
									))}
								</TabsList>
								{searchBox}
							</div>
							{filtered.length === 0 ? (
								<EmptyState
									compact
									title={
										needle === "" ? "No agent programs found" : "No providers match your search."
									}
									body={
										needle === ""
											? "Install an agent program on this Mac, then choose Refresh."
											: undefined
									}
									action={
										needle === "" ? (
											<Button variant="secondary" onClick={() => void refresh()}>
												Refresh
											</Button>
										) : undefined
									}
								/>
							) : null}
							{!anyInstalled && filtered.length > 0 ? (
								<p className="text-sm text-fg-muted">
									No agent programs were found. Install one below, then choose Refresh.
								</p>
							) : null}
							{filtered.map((install) => (
								<TabsContent
									key={agentKey(install.agent, install.acpAgent)}
									value={agentKey(install.agent, install.acpAgent)}
								>
									<AgentCard
										install={install}
										signInBusy={busyKey === agentKey(install.agent, install.acpAgent)}
										onSignIn={() => void startLogin(install)}
										onProviders={() => setProviders(install)}
										onRefresh={() => void refresh()}
										refreshing={refreshing}
										onCopyPath={(path) => void copy(path, "Copied the program path")}
										configAction={
											install.agent === "claude"
												? { label: "Claude settings", onClick: () => setConfigAgent("claude") }
												: install.agent === "codex"
													? { label: "Codex config", onClick: () => setConfigAgent("codex") }
													: undefined
										}
									>
										{install.agent === "claude" ? (
											<RegistrySettingRowByKey settingKey="chrome_mode_enabled" />
										) : undefined}
									</AgentCard>
								</TabsContent>
							))}
						</Tabs>
					);
				}}
			</LoadableView>

			<McpServersPanel />

			{providers ? (
				<AgentProvidersDialog
					open
					install={providers}
					onOpenChange={(open) => {
						if (!open) setProviders(null);
					}}
					onSignIn={() => {
						const target = providers;
						if (target === null) return;
						setProviders(null);
						void startLogin(target);
					}}
				/>
			) : null}

			{configAgent ? (
				<AgentConfigDialog
					agent={configAgent}
					open
					onOpenChange={(open) => {
						if (!open) setConfigAgent(null);
					}}
				/>
			) : null}

			{login ? (
				<AgentLoginDialog
					open
					agentName={login.name}
					flow={login.flow}
					error={login.error}
					signedIn={signedIn}
					finishing={login.finishing}
					requiresCode={login.requiresCode}
					onOpenUrl={openUrl}
					onOpenChange={closeLogin}
					onRetry={() => void retryLogin()}
					onFinish={(code) => {
						if (login.loginId !== null) {
							void finishLogin(login.loginId, code, {
								agent: login.agent,
								acpAgent: login.acpAgent,
							});
						}
					}}
					onCopy={(text) =>
						void copy(
							text,
							login.agent === "codex"
								? "Copied Codex verification code."
								: "Copied to the clipboard",
						)
					}
				/>
			) : null}
		</div>
	);
}
