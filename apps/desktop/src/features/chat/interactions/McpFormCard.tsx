/**
 * @feature CHAT-11 MCP form card
 * Owns: The card that shows a form an MCP server asks the user to fill in, and sends the values
 * back.
 * Behaviour: other-runners.md 4 (Codex MCP forms), packages/protocol/src/interactions.ts (mcp_form:
 * server, message, JSON schema).
 * Our design choice: Renders the common JSON Schema field types (string, number, boolean, enum). A
 * schema it cannot render shows the message and offers Decline only.
 * Must handle: Required fields (Accept stays disabled until they are filled); invalid input (a
 * message under the field); Accept, Decline and Cancel map to the three protocol actions; unknown
 * schema (Decline only, with the reason); a request that expires shows that it timed out. The
 * caller removes the card when the interaction is withdrawn.
 * Test first: A schema with one required string blocks Accept until it has text.
 */

import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import type { Clock, InteractionId, SessionId } from "@conducted/shared";
import { useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Checkbox } from "../../../ui/Checkbox.tsx";
import { Input, Label } from "../../../ui/Input.tsx";
import { Select } from "../../../ui/Select.tsx";
import { asRecord, withKeys } from "../tools/ToolCardFrame.tsx";
import { TIMED_OUT_TEXT, useExpiry } from "./use-expiry.ts";
import { useInteractionAnswer } from "./use-interaction-answer.ts";

export interface McpFormCardProps {
	sessionId: SessionId;
	interactionId: InteractionId;
	request: Extract<Interaction, { kind: "mcp_form" }>;
	/** When the agent stops waiting, in milliseconds since the epoch. Missing: no limit. */
	expiresAt?: number | null;
	/** The agent already stopped waiting. */
	timedOut?: boolean;
	/** The clock the expiry timer reads. Tests pass a fake one. */
	clock?: Clock;
}

type FieldKind = "string" | "number" | "boolean" | "enum";

interface FormField {
	key: string;
	label: string;
	description: string | null;
	required: boolean;
	kind: FieldKind;
	options: string[];
}

type ParsedSchema = { ok: true; fields: FormField[] } | { ok: false; reason: string };

/** Radix Select cannot hold an empty value, so an unset enum uses this stand-in. */
const UNSET = "__choose__";

/** Reads the parts of a JSON Schema this card can show. Anything else needs a different card. */
function parseSchema(schema: unknown): ParsedSchema {
	const record = asRecord(schema);
	if (record.type !== "object") {
		return { ok: false, reason: "This form is not a set of named fields." };
	}
	const properties = asRecord(record.properties);
	const required = Array.isArray(record.required)
		? record.required.filter((value): value is string => typeof value === "string")
		: [];
	const fields: FormField[] = [];

	for (const [key, raw] of Object.entries(properties)) {
		const field = asRecord(raw);
		const label = typeof field.title === "string" ? field.title : key;
		const description = typeof field.description === "string" ? field.description : null;
		const isRequired = required.includes(key);

		if (Array.isArray(field.enum)) {
			const options = field.enum.filter((value): value is string => typeof value === "string");
			if (options.length === 0) {
				return { ok: false, reason: `The field "${key}" has no choices this app can show.` };
			}
			fields.push({
				key,
				label,
				description,
				required: isRequired,
				kind: "enum",
				options,
			});
			continue;
		}

		if (field.type === "string") {
			fields.push({ key, label, description, required: isRequired, kind: "string", options: [] });
			continue;
		}
		if (field.type === "number" || field.type === "integer") {
			fields.push({ key, label, description, required: isRequired, kind: "number", options: [] });
			continue;
		}
		if (field.type === "boolean") {
			fields.push({ key, label, description, required: isRequired, kind: "boolean", options: [] });
			continue;
		}
		return { ok: false, reason: `The field "${key}" is a kind of field this app cannot show.` };
	}

	if (fields.length === 0) {
		return { ok: false, reason: "This form has no fields this app can show." };
	}
	return { ok: true, fields };
}

/** Why a field cannot be sent, or null when it can. */
function fieldError(field: FormField, value: string | boolean): string | null {
	if (field.kind === "boolean") return null;
	if (typeof value !== "string") return null;
	if (field.kind === "number" && value.trim() !== "" && !Number.isFinite(Number(value))) {
		return "Enter a number.";
	}
	return null;
}

/** True when a required field still has no value. */
function fieldMissing(field: FormField, value: string | boolean): boolean {
	if (!field.required || field.kind === "boolean") return false;
	return typeof value !== "string" || value.trim() === "";
}

function initialValues(fields: readonly FormField[]): Record<string, string | boolean> {
	return Object.fromEntries(
		fields.map((field) => [field.key, field.kind === "boolean" ? false : ""]),
	);
}

export function McpFormCard({
	sessionId,
	interactionId,
	request,
	expiresAt = null,
	timedOut = false,
	clock,
}: McpFormCardProps) {
	const parsed = parseSchema(request.schema);
	const [values, setValues] = useState<Record<string, string | boolean>>(() =>
		parsed.ok ? initialValues(parsed.fields) : {},
	);
	const expired = useExpiry(expiresAt, clock);
	const timedOutNow = timedOut || expired;
	const answerState = useInteractionAnswer<Extract<InteractionAnswer, { kind: "mcp_form" }>>({
		sessionId,
		interactionId,
		blocked: timedOutNow,
		labelFor: (answer) =>
			answer.action === "accept"
				? "Accepted"
				: answer.action === "decline"
					? "Declined"
					: "Cancelled",
	});
	const pending = answerState.pending !== null;
	const chosen = answerState.chosen;
	const fields = parsed.ok ? parsed.fields : [];
	const valid =
		parsed.ok &&
		parsed.fields.every((field) => {
			const value = values[field.key] ?? (field.kind === "boolean" ? false : "");
			return fieldError(field, value) === null && !fieldMissing(field, value);
		});
	const keyed = withKeys(fields, (field) => field.key, "field");

	function setValue(key: string, value: string | boolean): void {
		setValues((current) => ({ ...current, [key]: value }));
	}

	function send(answer: Extract<InteractionAnswer, { kind: "mcp_form" }>): void {
		void answerState.answer(answer);
	}

	function accept(): void {
		if (!parsed.ok) return;
		const content: Record<string, unknown> = {};
		for (const field of parsed.fields) {
			const value = values[field.key] ?? (field.kind === "boolean" ? false : "");
			if (field.kind === "boolean") {
				content[field.key] = value === true;
				continue;
			}
			if (typeof value !== "string" || (value.trim() === "" && !field.required)) continue;
			content[field.key] = field.kind === "number" ? Number(value) : value;
		}
		send({ kind: "mcp_form", action: "accept", content });
	}

	function cancel(): void {
		send({ kind: "mcp_form", action: "cancel" });
	}

	function decline(): void {
		send({ kind: "mcp_form", action: "decline" });
	}

	return (
		<fieldset
			aria-label="MCP form"
			className="m-0 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3"
		>
			<p className="text-sm font-medium text-fg">Form from {request.server}</p>
			<p className="text-sm text-fg-muted">{request.message}</p>

			{parsed.ok ? (
				<div className="flex flex-col gap-3">
					{keyed.map(({ key, item: field }) => {
						const value = values[field.key] ?? (field.kind === "boolean" ? false : "");
						const error = fieldError(field, value);
						const id = `mcp-field-${field.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
						if (field.kind === "boolean") {
							return (
								<div key={key} className="flex flex-col gap-1">
									<div className="flex items-center gap-2 text-sm text-fg">
										<Checkbox
											id={id}
											aria-label={field.label}
											checked={value === true}
											onCheckedChange={(checked) => setValue(field.key, checked)}
											disabled={pending || chosen !== null || timedOutNow}
										/>
										<label htmlFor={id} className="text-sm text-fg">
											{field.label}
											{field.required ? " *" : ""}
										</label>
									</div>
									{field.description === null ? null : (
										<span className="text-xs text-fg-muted">{field.description}</span>
									)}
								</div>
							);
						}
						if (field.kind === "enum") {
							const text = typeof value === "string" ? value : "";
							return (
								<div key={key} className="flex flex-col gap-1">
									<Label htmlFor={id}>
										{field.label}
										{field.required ? " *" : ""}
									</Label>
									<Select
										id={id}
										aria-label={field.label}
										value={text === "" ? UNSET : text}
										options={[
											{ value: UNSET, label: "Choose..." },
											...field.options.map((option) => ({ value: option, label: option })),
										]}
										onValueChange={(next) => setValue(field.key, next === UNSET ? "" : next)}
										disabled={pending || chosen !== null || timedOutNow}
									/>
									{field.description === null ? null : (
										<span className="text-xs text-fg-muted">{field.description}</span>
									)}
								</div>
							);
						}
						return (
							<div key={key} className="flex flex-col gap-1">
								<Label htmlFor={id}>
									{field.label}
									{field.required ? " *" : ""}
								</Label>
								<Input
									id={id}
									aria-label={field.label}
									type="text"
									inputMode={field.kind === "number" ? "decimal" : undefined}
									value={typeof value === "string" ? value : ""}
									onChange={(event) => setValue(field.key, event.target.value)}
									error={error ?? undefined}
									disabled={pending || chosen !== null || timedOutNow}
								/>
								{field.description === null ? null : (
									<span className="text-xs text-fg-muted">{field.description}</span>
								)}
							</div>
						);
					})}
				</div>
			) : (
				<p className="rounded-md border border-warning-border bg-warning-surface px-2 py-1.5 text-xs text-warning-fg">
					{parsed.reason}
				</p>
			)}

			{answerState.failed === null ? null : (
				<p role="alert" className="text-xs text-danger">
					Could not send the answer: {answerState.failed}
				</p>
			)}

			{timedOutNow ? (
				<p role="status" className="text-sm text-fg-muted">
					{TIMED_OUT_TEXT}
				</p>
			) : answerState.chosen !== null ? (
				<p role="status" className="text-sm font-medium text-fg">
					{answerState.chosen}
				</p>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					{parsed.ok ? (
						<>
							<Button onClick={accept} loading={pending} disabled={!valid}>
								Accept
							</Button>
							<Button variant="secondary" onClick={decline} disabled={pending}>
								Decline
							</Button>
							<Button variant="ghost" onClick={cancel} disabled={pending}>
								Cancel
							</Button>
						</>
					) : (
						<Button variant="secondary" onClick={decline} disabled={pending}>
							Decline
						</Button>
					)}
				</div>
			)}
		</fieldset>
	);
}
