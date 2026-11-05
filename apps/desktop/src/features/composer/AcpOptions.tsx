/**
 * @feature AGENT-17 ACP chat options beyond the model
 * Owns: the composer controls for an ACP chat's own options, and the two messages about saved
 * options that cannot be loaded.
 * Behaviour: research/conductor/other-runners.md sections 2.2 and 5, services-map.md 2.5.2 and
 * 5B.5.4. The agent's options are fetched per chat, the saved choices are applied when the chat is
 * reloaded, and one choice is set through the chat service.
 * Must handle: options still loading, a fetch that fails ("Couldn't load saved model options"),
 * saved values that did not load ("Some saved model options could not be loaded. Choose those
 * options again."), a set that fails (an error toast), and agents other than ACP, which render
 * nothing. Each control shows the agent's own value, so a saved choice that did not load is never
 * shown as chosen.
 * Our design choice: the sidecar applies every saved choice the agent takes before it lists the
 * options, and skips one the agent no longer offers or refuses (runners/acp/acp-session.ts). So
 * this file does not judge a saved value itself: a saved choice did not load when its option is gone
 * or shows another value. The rule of what an agent accepts stays in the sidecar.
 * Our design choice: each option is one toolbar control, a menu for a select and a switch button
 * for a boolean, so the composer keeps the same shape as the other chat controls.
 * Test first: a saved option value the agent no longer offers shows the "choose those options
 * again" message.
 */
import type { AcpConfigOption } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useAcpConfigOptions, useActions } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { CheckIcon } from "../../ui/icons.tsx";
import {
	Menu,
	MenuChoiceItemContents,
	MenuContent,
	MenuItem,
	MenuTrigger,
} from "../../ui/Menu.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";

export interface AcpOptionsProps {
	sessionId: SessionId;
}

/** The saved choices that did not load, by option id: the option is gone or shows another value. */
export function missingSavedOptions(
	options: readonly AcpConfigOption[],
	saved: Readonly<Record<string, string | boolean>> | undefined,
): string[] {
	if (saved === undefined) return [];
	return Object.entries(saved)
		.filter(([optionId, value]) => {
			const option = options.find((entry) => entry.id === optionId);
			return option === undefined || option.value.current !== value;
		})
		.map(([optionId]) => optionId);
}

export function AcpOptions({ sessionId }: AcpOptionsProps) {
	const actions = useActions();
	const { services } = useServices();
	const session = useStore(services.sessions.store, (state) => state.sessions[sessionId]);
	const load = useAcpConfigOptions(sessionId);
	const reportedError = useRef<string | null>(null);
	const reportedMissing = useRef<string | null>(null);
	const config = session?.config;
	// A chat that never ran has nothing saved, so a failed start is not a lost-options warning.
	const hadSavedOptions =
		Object.keys(config?.acpConfig ?? {}).length > 0 || session?.agentSessionId != null;

	useEffect(() => {
		if (load.state !== "error" || !hadSavedOptions) {
			reportedError.current = null;
			return;
		}
		const key = `${sessionId}:${load.error.message}`;
		if (reportedError.current === key) return;
		reportedError.current = key;
		toastError("Couldn't load saved model options", load.error);
	}, [sessionId, load, hadSavedOptions]);

	useEffect(() => {
		if (load.state !== "ready" || config === undefined) return;
		const missing = missingSavedOptions(load.data, config.acpConfig);
		if (missing.length === 0) {
			reportedMissing.current = null;
			return;
		}
		const key = `${sessionId}:${missing.join(",")}`;
		if (reportedMissing.current === key) return;
		reportedMissing.current = key;
		toast.warning("Some saved model options could not be loaded. Choose those options again.");
	}, [sessionId, load, config]);

	if (config === undefined || config.agent !== "acp") return null;
	if (load.state === "loading") return null;
	if (load.state === "error" || load.data.length === 0) return null;

	const setOption = (optionId: string, value: string | boolean): void => {
		void actions.sessions.setAcpOption(sessionId, optionId, value).then((result) => {
			if (!result.ok) toastError("Couldn't change that option", result.error);
		});
	};

	return (
		<div className="flex items-center gap-1">
			{load.data.map((option) => {
				const value = option.value.current;
				if (option.value.kind === "switch") {
					const on = value === true;
					return (
						<Button
							key={option.id}
							variant="ghost"
							size="xs"
							aria-label={option.name}
							aria-pressed={on}
							className="aria-pressed:rounded-full aria-pressed:bg-primary-fill aria-pressed:text-canvas aria-pressed:hover:opacity-90"
							onClick={() => setOption(option.id, !on)}
						>
							{option.name}
						</Button>
					);
				}
				const chosen = option.value.choices.find((choice) => choice.value === value);
				return (
					<Menu key={option.id}>
						<MenuTrigger asChild>
							<Button
								variant="ghost"
								size="xs"
								aria-label={`${option.name}: ${chosen?.name ?? String(value)}`}
							>
								{option.name}: {chosen?.name ?? String(value)}
							</Button>
						</MenuTrigger>
						<MenuContent align="start">
							{option.value.choices.map((choice) => (
								<MenuItem key={choice.value} onSelect={() => setOption(option.id, choice.value)}>
									<MenuChoiceItemContents
										indicator={choice.value === value ? <CheckIcon /> : <span />}
									>
										{choice.name}
									</MenuChoiceItemContents>
								</MenuItem>
							))}
						</MenuContent>
					</Menu>
				);
			})}
		</div>
	);
}
