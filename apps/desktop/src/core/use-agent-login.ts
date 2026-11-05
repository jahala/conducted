/**
 * @feature APP-02 Onboarding: agents
 * Owns: the sign-in state machine shared by the onboarding agents step and the Agents settings page:
 * starting a flow, the newest start winning, the auto-finish of Codex and Cursor, finishing, and
 * cancelling.
 * Behaviour: ui-map.md 6, 7.1 and other-runners.md 5 (agent detection and sign-in flows). The
 * protocol's startAgentLogin, finishAgentLogin and cancelAgentLogin are in packages/protocol rpc.ts.
 * Our design choice: the newest start owns the panel. A start that loses the race is cancelled in
 * the sidecar, so no sign-in keeps running unseen. Only Claude waits for a pasted code.
 * Must handle: two starts that overlap; a start that fails (a panel with Retry); a finish that
 * fails or does not sign in (the panel stays with its message); a cancel that fails (the caller's
 * reporter); a flow that needs a pasted code.
 * Test first: a second start that finishes first keeps its panel when the first start answers
 * later, and the first sign-in is cancelled.
 */
import type { AgentLogin } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { useCallback, useRef, useState } from "react";
import { useActions } from "./hooks.ts";
import { agentDisplayName, agentKey } from "./services/agent-catalog.ts";

export interface AgentLoginSelection {
	agent: AgentKind;
	acpAgent?: AcpAgent;
}

export interface AgentLoginState extends AgentLoginSelection {
	key: string;
	name: string;
	loginId: string | null;
	flow: AgentLogin | null;
	error: string | null;
	finishing: boolean;
	requiresCode: boolean;
}

export interface UseAgentLoginOptions {
	/** Called after a sign-in ends or is cancelled, to refresh the install list. */
	onRefresh?: () => void | Promise<void>;
	/** Called when a cancel fails, or a superseded start cannot be ended. */
	onCancelFailed?: (message: string) => void;
}

/** Claude signs in by handing the user a code to paste back. Codex and Cursor finish themselves. */
export const needsPastedCode = (agent: AgentKind): boolean => agent === "claude";

export interface AgentLoginControls {
	busyKey: string | null;
	login: AgentLoginState | null;
	code: string;
	setCode: (text: string) => void;
	start: (selection: AgentLoginSelection) => Promise<void>;
	finish: (loginId: string, pastedCode?: string) => Promise<void>;
	cancel: (loginId: string) => Promise<void>;
	/** Shows the message on the open sign-in panel, for example when opening its link fails. */
	setLoginError: (loginId: string | null, message: string) => void;
}

export function useAgentLogin(options: UseAgentLoginOptions = {}): AgentLoginControls {
	const actions = useActions();
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [login, setLogin] = useState<AgentLoginState | null>(null);
	const [code, setCode] = useState("");
	/** The newest sign-in start. An older answer never replaces the panel it opened. */
	const request = useRef(0);
	const loginRef = useRef<AgentLoginState | null>(null);
	loginRef.current = login;
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const finish = useCallback(
		async (loginId: string, pastedCode?: string) => {
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
			await optionsRef.current.onRefresh?.();
		},
		[actions],
	);

	const start = useCallback(
		async (selection: AgentLoginSelection) => {
			const key = agentKey(selection.agent, selection.acpAgent);
			const name = agentDisplayName(selection);
			const id = ++request.current;
			setBusyKey(key);
			const started = await actions.agents.login(selection.agent, selection.acpAgent);
			if (id !== request.current) {
				// A newer start owns the panel. End this one so no sign-in runs unseen.
				if (started.ok) {
					void actions.agents.cancelLogin(started.value.loginId).then((cancelled) => {
						if (!cancelled.ok) optionsRef.current.onCancelFailed?.(cancelled.error.message);
					});
				}
				return;
			}
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
			setLogin({
				...selection,
				key,
				name,
				loginId: started.value.loginId,
				flow: started.value,
				error: null,
				finishing: false,
				requiresCode: needsPastedCode(selection.agent),
			});
			if (selection.agent === "codex" || selection.agent === "cursor") {
				void finish(started.value.loginId);
			}
		},
		[actions, finish],
	);

	const cancel = useCallback(
		async (loginId: string) => {
			setLogin(null);
			setCode("");
			const cancelled = await actions.agents.cancelLogin(loginId);
			if (!cancelled.ok) {
				optionsRef.current.onCancelFailed?.(cancelled.error.message);
				return;
			}
			await optionsRef.current.onRefresh?.();
		},
		[actions],
	);

	const setLoginError = useCallback((loginId: string | null, message: string) => {
		setLogin((current) =>
			current?.loginId === loginId ? { ...current, error: message } : current,
		);
	}, []);

	return { busyKey, login, code, setCode, start, finish, cancel, setLoginError };
}
