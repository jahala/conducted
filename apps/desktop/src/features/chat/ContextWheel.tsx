/**
 * @feature CHAT-14 Context wheel, cost and plan usage
 * Owns: the small ring in the composer toolbar that shows how much of the model's context window is
 * used, and its hover card: window used, token breakdown, model, effort, service tier, fast mode and
 * the turn's cost when Show agent cost is on.
 * Behaviour: ui-map.md 3.3 (context wheel shown above 70 percent or always with "Always show context
 * usage"; hover card "Context", "Window used", Input, Cached input, Output, model, effort, service
 * tier, "Fast mode"; notes "Context window size not yet available." and "Context usage is
 * unavailable for Cursor."), claude-runner.md 7 (usage is reported per turn, and so is its cost).
 * Our design choice: the ring is neutral until 85 percent, warning until 95, then danger. The card
 * also opens on keyboard focus.
 * Plan usage and the signed-in account are drawn by UsageAccountRows (CHAT-28) for Claude and
 * Codex chats: the card asks the sidecar's getContextUsage each time it opens, as Conductor asks
 * only while its card is open, and only the newest answer is shown.
 * A chat whose agent has not reported its window yet uses the size the same agent last reported
 * for the same model in any chat (ContextWindowService); no sizes ship with the app.
 * Must handle: window size unknown (the note and an empty ring, no invented percentage); Cursor
 * (its note); usage above the window (clamped at 100 percent); the setting off and usage at or
 * below 70 percent (nothing rendered); no usage event yet (the chat's stored context tokens); a
 * chat with no session (nothing).
 * Test first: 72,000 of 100,000 tokens shows a 72% ring; 40% with the setting off renders nothing.
 */

import type { SessionEvent } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useRef, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useSetting } from "../../core/hooks.ts";
import type { Session } from "../../core/model.ts";
import { contextWindowKey } from "../../core/services/context-windows.ts";
import { Button } from "../../ui/Button.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { UsageAccountRows, type UsageAnswer } from "./UsageAccountRows.tsx";

export interface ContextWheelProps {
	sessionId: SessionId;
}

type AgentEvent = Extract<SessionEvent, { type: "agent" }>;
type UsageItem = Extract<AgentEvent["message"]["items"][number], { kind: "usage" }>;

const tokenFormat = new Intl.NumberFormat("en-US");

function formatTokens(tokens: number): string {
	return tokenFormat.format(tokens);
}

/** Dollars as the chat shows them, in the wheel's card and in the turn footer. */
export function formatCost(usd: number): string {
	return usd.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 4,
	});
}

/** The last usage item in the chat's stored events, or null when none was reported yet. */
function latestUsage(events: readonly { event: SessionEvent }[] | undefined): UsageItem | null {
	if (events === undefined) return null;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index]?.event;
		if (event?.type !== "agent") continue;
		const items = event.message.items;
		for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
			const item = items[itemIndex];
			if (item?.kind === "usage") return item;
		}
	}
	return null;
}

/** The share of the context window used, 0 to 1. Null when the window is unknown. */
function shareOf(usedTokens: number | null, windowTokens: number | null): number | null {
	if (usedTokens === null || windowTokens === null || windowTokens <= 0) return null;
	return usedTokens / windowTokens;
}

/** The rounded percentage, clamped to 0..100. Null when the window is unknown. */
function percentOf(share: number | null): number | null {
	if (share === null) return null;
	return Math.max(0, Math.min(100, Math.round(share * 100)));
}

/** A small radial progress mark. An unknown percentage draws only the track. */
function RadialProgress({ percent }: { percent: number | null }) {
	const size = 16;
	const stroke = 2;
	const radius = (size - stroke) / 2;
	const circumference = 2 * Math.PI * radius;
	const fraction = percent === null ? 0 : Math.max(0, Math.min(100, percent)) / 100;
	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
			<circle
				cx={size / 2}
				cy={size / 2}
				r={radius}
				fill="none"
				stroke="currentColor"
				strokeOpacity={0.2}
				strokeWidth={stroke}
			/>
			{fraction > 0 ? (
				<circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={`${circumference * fraction} ${circumference}`}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
				/>
			) : null}
		</svg>
	);
}

function toneFor(percent: number | null): string {
	if (percent !== null && percent >= 95) return "text-danger";
	if (percent !== null && percent >= 85) return "text-warning";
	return "text-fg-subtle";
}

/** Reads the chat's recorded usage and, above 70 percent or when always shown, draws the wheel. */
export function ContextWheel({ sessionId }: ContextWheelProps) {
	const { services } = useServices();
	const session: Session | undefined = useStore(
		services.sessions.store,
		(state) => state.sessions[sessionId],
	);
	const events = useStore(services.sessions.store, (state) => state.events[sessionId]);
	// The size this agent last reported for the chat's model in any chat (CHAT-14).
	const knownWindow = useStore(services.contextWindows.store, (state) =>
		session === undefined ? undefined : state.byModel[contextWindowKey(session.config)],
	);
	const alwaysShow = useSetting<boolean>("always_show_context_wheel");
	const showCost = useSetting<boolean>("experimental_show_agent_cost");
	const [planUsage, setPlanUsage] = useState<{
		answer: UsageAnswer | null;
		loading: boolean;
		at: number;
	}>({ answer: null, loading: false, at: 0 });
	const latestRequest = useRef(0);
	const agent = session?.config.agent;
	const usageAgent = agent === "claude" || agent === "codex" ? agent : null;

	// Asked each time the card opens; an answer a newer request overtook is dropped.
	const readPlanUsage = async () => {
		latestRequest.current += 1;
		const request = latestRequest.current;
		setPlanUsage((current) => ({ ...current, loading: true }));
		const result = await services.sessions.contextUsage(sessionId);
		if (request !== latestRequest.current) return;
		setPlanUsage({
			answer: result.ok ? result.value : null,
			loading: false,
			at: Date.now(),
		});
	};

	if (session === undefined) return null;

	const usage = latestUsage(events);
	const usedTokens = usage?.contextUsedTokens ?? session.contextUsedTokens;
	const windowTokens =
		usage?.contextWindowTokens ?? session.contextWindowTokens ?? knownWindow ?? null;
	const share = shareOf(usedTokens, windowTokens);
	const percent = percentOf(share);
	const isCursor = session.config.agent === "cursor";
	const unavailable =
		isCursor && usage === null
			? "Context usage is unavailable for Cursor."
			: windowTokens === null
				? "Context window size not yet available."
				: null;
	if (!alwaysShow && (share === null || share <= 0.7)) return null;

	const model = usage?.model ?? session.config.model;
	const fastMode = usage?.fastMode ?? (session.config.fastMode ? true : null);
	const label = percent === null ? "Context usage: not available" : `Context usage: ${percent}%`;

	return (
		<Popover
			hover
			side="top"
			align="end"
			onOpenChange={(open) => {
				if (open && usageAgent !== null) void readPlanUsage();
			}}
			trigger={
				<Button variant="ghost" size="xs" className="px-0" aria-label={label}>
					<span className={toneFor(percent)}>
						<RadialProgress percent={percent} />
					</span>
					<span className="sr-only">{percent === null ? "Not available" : `${percent}%`}</span>
				</Button>
			}
		>
			<div className="flex w-64 flex-col gap-2">
				<div className="flex items-center justify-between">
					<span className="font-medium text-fg">Context</span>
					{percent === null ? null : <span className="text-xs text-fg-muted">{percent}%</span>}
				</div>
				{unavailable === null ? null : <p className="text-xs text-fg-muted">{unavailable}</p>}
				{usedTokens === null || windowTokens === null ? null : (
					<p className="text-xs text-fg-muted">
						Window used: {formatTokens(usedTokens)} of {formatTokens(windowTokens)} tokens
					</p>
				)}
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
					{usage === null ? null : (
						<>
							<dt className="text-fg-muted">Input</dt>
							<dd>{formatTokens(usage.inputTokens)}</dd>
							<dt className="text-fg-muted">Cached input</dt>
							<dd>{formatTokens(usage.cacheReadTokens)}</dd>
							<dt className="text-fg-muted">Cache write</dt>
							<dd>{formatTokens(usage.cacheWriteTokens)}</dd>
							<dt className="text-fg-muted">Output</dt>
							<dd>{formatTokens(usage.outputTokens)}</dd>
						</>
					)}
					<dt className="text-fg-muted">Model</dt>
					<dd>{model}</dd>
					<dt className="text-fg-muted">Effort</dt>
					<dd>{session.config.effort}</dd>
					{usage?.serviceTier === undefined ? null : (
						<>
							<dt className="text-fg-muted">Service tier</dt>
							<dd>{usage.serviceTier}</dd>
						</>
					)}
					{fastMode === null ? null : (
						<>
							<dt className="text-fg-muted">Fast mode</dt>
							<dd>{fastMode ? "On" : "Off"}</dd>
						</>
					)}
					{showCost && usage?.costUsd !== undefined ? (
						<>
							<dt className="text-fg-muted">Cost</dt>
							<dd>{formatCost(usage.costUsd)}</dd>
						</>
					) : null}
				</dl>
				{usageAgent === null ? null : (
					<UsageAccountRows
						agent={usageAgent}
						answer={planUsage.answer}
						loading={planUsage.loading}
						now={planUsage.at}
					/>
				)}
			</div>
		</Popover>
	);
}
