/**
 * @feature CHAT-20 Task details card
 * Owns: The card for the agent reading one task, and the task field readers the other task cards
 * share.
 * Behaviour: ui-map.md 3.3 (Tasks: 'Task details' with Status, Subject, Blocked by, Blocks).
 * Must handle: A task that no longer exists (its raw result is shown); empty Blocked by and Blocks
 * lists ('None'); a result that is JSON or the agent's text form.
 * Test first: A task_get result renders 'Task details' with its status and subject.
 */
import { Fragment } from "react";
import { ListTodoIcon } from "../../../../ui/icons.tsx";
import { asRecord, ToolCardFrame, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export interface TaskFields {
	id: string | null;
	subject: string | null;
	status: string | null;
	description: string | null;
	blockedBy: string[];
	blocks: string[];
}

function emptyTask(): TaskFields {
	return {
		id: null,
		subject: null,
		status: null,
		description: null,
		blockedBy: [],
		blocks: [],
	};
}

type ParsedJson = { kind: "json"; value: unknown } | { kind: "text" };

/** JSON when the text is JSON, otherwise the text form a task tool prints. */
function parseJson(text: string): ParsedJson {
	const trimmed = text.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return { kind: "text" };
	try {
		return { kind: "json", value: JSON.parse(trimmed) };
	} catch {
		return { kind: "text" };
	}
}

function textList(value: unknown): string[] {
	if (typeof value === "string") {
		if (value.trim() === "" || /^(none|—|-)$/i.test(value.trim())) return [];
		return value
			.split(/[,;]+/)
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}
	if (!Array.isArray(value)) return [];
	const items: string[] = [];
	for (const entry of value) {
		if (typeof entry === "string" || typeof entry === "number") {
			items.push(String(entry));
			continue;
		}
		const record = asRecord(entry);
		const label = textField(record, "subject", "name", "id", "taskId", "task_id");
		if (label !== null) items.push(label);
	}
	return items;
}

function taskFieldsFromText(text: string): TaskFields {
	const fields: TaskFields = { ...emptyTask() };
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		const header = /^Task\s+#?([\w-]+):\s*(.*)$/i.exec(trimmed);
		if (header) {
			fields.id = header[1] ?? null;
			fields.subject = header[2] === "" ? null : (header[2] ?? null);
			continue;
		}
		const pair = /^([A-Za-z ]+):\s*(.*)$/.exec(trimmed);
		if (pair === null) continue;
		const label = (pair[1] ?? "").trim().toLowerCase();
		const value = (pair[2] ?? "").trim();
		if (label === "status") fields.status = value === "" ? null : value;
		else if (label === "subject") fields.subject = value === "" ? null : value;
		else if (label === "description") fields.description = value === "" ? null : value;
		else if (label === "blocked by" || label === "depends on") fields.blockedBy = textList(value);
		else if (label === "blocks") fields.blocks = textList(value);
	}
	return fields;
}

/** Reads one task from an object, a JSON string, or the agent's line-based text. */
export function taskFieldsFrom(value: unknown): TaskFields {
	if (typeof value === "string") {
		const parsed = parseJson(value);
		return parsed.kind === "json" ? taskFieldsFrom(parsed.value) : taskFieldsFromText(value);
	}
	const record = asRecord(value);
	return {
		id: textField(record, "id", "taskId", "task_id"),
		subject: textField(record, "subject", "title", "name"),
		status: textField(record, "status", "state"),
		description: textField(record, "description", "details"),
		blockedBy: textList(
			record.blockedBy ??
				record.blocked_by ??
				record.dependsOn ??
				record.depends_on ??
				record.addBlockedBy ??
				record.add_blocked_by,
		),
		blocks: textList(record.blocks ?? record.blocking ?? record.addBlocks ?? record.add_blocks),
	};
}

export function hasTaskFields(fields: TaskFields): boolean {
	return (
		fields.id !== null ||
		fields.subject !== null ||
		fields.status !== null ||
		fields.description !== null ||
		fields.blockedBy.length > 0 ||
		fields.blocks.length > 0
	);
}

/** One task from a completed result, or null when the result carries no task. */
export function readTask(output: string): TaskFields | null {
	if (output.trim() === "") return null;
	const parsed = parseJson(output);
	const fields = parsed.kind === "json" ? taskFieldsFrom(parsed.value) : taskFieldsFromText(output);
	return hasTaskFields(fields) ? fields : null;
}

/** The tasks in a completed list result, or null when the result is not a task list. */
export function readTasks(output: string): TaskFields[] | null {
	const text = output.trim();
	if (text === "" || /^no tasks?\b/i.test(text)) return [];
	const parsed = parseJson(text);
	if (parsed.kind === "json") {
		if (Array.isArray(parsed.value)) {
			return parsed.value.map(taskFieldsFrom).filter(hasTaskFields);
		}
		const record = asRecord(parsed.value);
		if (Array.isArray(record.tasks)) {
			return record.tasks.map(taskFieldsFrom).filter(hasTaskFields);
		}
		const single = taskFieldsFrom(parsed.value);
		return hasTaskFields(single) ? [single] : null;
	}
	const tasks: TaskFields[] = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		const bracket = /^#?([\w-]+)\s*\[([^\]]+)\]\s*(.+)$/.exec(trimmed);
		if (bracket) {
			tasks.push({
				...emptyTask(),
				id: bracket[1] ?? null,
				status: bracket[2] ?? null,
				subject: bracket[3] ?? null,
			});
			continue;
		}
		const header = /^(?:[-*]\s*)?Task\s+#?([\w-]+):\s*(.*)$/i.exec(trimmed);
		if (header) {
			tasks.push({ ...emptyTask(), id: header[1] ?? null, subject: header[2] ?? null });
		}
	}
	return tasks.length > 0 ? tasks : null;
}

/** Keeps the field the input names, otherwise the one the result returned. */
export function mergeTaskFields(base: TaskFields, extra: TaskFields | null): TaskFields {
	if (extra === null) return base;
	return {
		id: base.id ?? extra.id,
		subject: base.subject ?? extra.subject,
		status: base.status ?? extra.status,
		description: base.description ?? extra.description,
		blockedBy: base.blockedBy.length > 0 ? base.blockedBy : extra.blockedBy,
		blocks: base.blocks.length > 0 ? base.blocks : extra.blocks,
	};
}

/** The Status, Subject, Blocked by and Blocks rows shared by every task card. */
export function TaskFieldsBody({ fields }: { fields: TaskFields }) {
	const rows = [
		{ label: "Status", value: fields.status ?? "Not set" },
		{ label: "Subject", value: fields.subject ?? "Not set" },
		{
			label: "Blocked by",
			value: fields.blockedBy.length > 0 ? fields.blockedBy.join(", ") : "None",
		},
		{ label: "Blocks", value: fields.blocks.length > 0 ? fields.blocks.join(", ") : "None" },
	];
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
			{rows.map((row) => (
				<Fragment key={row.label}>
					<dt className="text-fg-muted">{row.label}</dt>
					<dd className="min-w-0 break-words text-fg">{row.value}</dd>
				</Fragment>
			))}
			{fields.description ? (
				<>
					<dt className="text-fg-muted">Description</dt>
					<dd className="min-w-0 whitespace-pre-wrap break-words text-fg">{fields.description}</dd>
				</>
			) : null}
		</dl>
	);
}

export function TaskGetCard({ call, defaultExpanded }: ToolCardProps) {
	const inputFields = taskFieldsFrom(call.item.input);
	const resultFields = call.result === null ? null : readTask(call.result.output);
	const fields = resultFields ?? (hasTaskFields(inputFields) ? inputFields : null);
	const raw = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Task details"
			summary={fields?.subject ?? fields?.id ?? undefined}
			status={toolStatus(call)}
			icon={<ListTodoIcon />}
			expandAll={defaultExpanded}
			body={
				fields !== null ? (
					<TaskFieldsBody fields={fields} />
				) : raw.length > 0 ? (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg-muted">
						{raw}
					</pre>
				) : (
					<p className="text-xs text-fg-subtle">
						{call.result === null ? "Loading task details." : "No task details were returned."}
					</p>
				)
			}
		/>
	);
}
