/**
 * @feature CHAT-20 Schedule wake-up card
 * Owns: The card for the agent asking to be woken up later.
 * Behaviour: ui-map.md 3.3 (schedule wakeup).
 * Must handle: A wake-up time in the past; a cancelled wake-up; a delay given in seconds or an
 * absolute time given as text or milliseconds.
 * Test first: A schedule_wakeup call shows when the agent will wake up.
 */
import { ClockIcon } from "../../../../ui/icons.tsx";
import {
	asRecord,
	boolField,
	numberField,
	ToolCardFrame,
	textField,
	toolStatus,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

function durationWords(seconds: number): string {
	if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	if (rest === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
	return `${hours}h ${rest}m`;
}

/** When the agent asked to wake, in words; null when the call names no time. */
function wakeText(input: Record<string, unknown>): string | null {
	const delay = numberField(
		input,
		"delaySeconds",
		"delay_seconds",
		"delay",
		"seconds",
		"inSeconds",
		"in_seconds",
	);
	if (delay !== null) {
		return delay <= 0 ? "Wake-up time is in the past" : `Wake up in ${durationWords(delay)}`;
	}
	const at = textField(
		input,
		"wakeAt",
		"wake_at",
		"scheduledAt",
		"scheduled_at",
		"at",
		"time",
		"when",
	);
	if (at === null) return null;
	const millis = /^\d+$/.test(at) ? Number(at) : Date.parse(at);
	if (!Number.isFinite(millis)) return `Wake up at ${at}`;
	if (millis <= Date.now()) return "Wake-up time is in the past";
	return `Wake up at ${new Date(millis).toLocaleString()}`;
}

export function ScheduleWakeupCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const reason = textField(input, "reason", "description");
	const cancelled =
		boolField(input, "cancelled", "canceled") ||
		textField(input, "status", "state")?.toLowerCase() === "cancelled";
	const when = cancelled ? null : wakeText(input);
	return (
		<ToolCardFrame
			title={cancelled ? "Wake-up cancelled" : "Schedule wakeup"}
			summary={cancelled ? (reason ?? undefined) : (when ?? reason ?? undefined)}
			status={toolStatus(call)}
			icon={<ClockIcon />}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{cancelled ? (
						<p className="text-sm text-fg-muted">This wake-up was cancelled.</p>
					) : when ? (
						<p className="text-sm text-fg">{when}</p>
					) : (
						<p className="text-sm text-fg-muted">This call names no wake-up time.</p>
					)}
					{reason && !cancelled ? <p className="text-sm text-fg-muted">{reason}</p> : null}
				</div>
			}
		/>
	);
}
