/**
 * @feature test support Made-up Conductor chats for the chat history import's tests (APP-18)
 * Owns: `conductorChatRows`, which turns a chat written as turns of user text and Claude SDK
 * payloads into `session_messages` rows with ids, turn ids and increasing send times;
 * `KNOWN_CHAT`, a chat of three turns whose transcript is known by hand; and the payload helpers.
 * Behaviour: docs/research/conductor/frontend.md section 5 ("What one turn shows"): Conductor
 * stores a row per user message and a row per agent payload it keeps, and the SDK streams one
 * row per content block. The same shape as the spike's known case (scripts/conductor-import).
 * Must handle: send times are unique and increasing, one second apart, so the order Conductor's
 * chat reads is the order written here; a row's created time equals its send time.
 * Test first: not applicable, test support only.
 */

export type ChatRow = { role: "user"; text: string } | { role: "assistant"; payload: unknown };
export interface ChatTurnRows {
	turnId: string;
	rows: ChatRow[];
}

export const said = (text: string): ChatRow => ({ role: "user", text });
export const wrote = (payload: unknown): ChatRow => ({ role: "assistant", payload });

export const assistant = (uuid: string, content: unknown[], parent: string | null = null) => ({
	type: "assistant",
	uuid,
	session_id: "claude-1",
	parent_tool_use_id: parent,
	message: { id: `msg-${uuid}`, role: "assistant", content },
});
export const text = (uuid: string, value: string, parent: string | null = null) =>
	assistant(uuid, [{ type: "text", text: value }], parent);
export const toolUse = (id: string, name: string, input: unknown, parent: string | null = null) =>
	assistant(`u-${id}`, [{ type: "tool_use", id, name, input }], parent);
export const toolResult = (id: string, output: string, parent: string | null = null) => ({
	type: "user",
	uuid: `r-${id}`,
	session_id: "claude-1",
	parent_tool_use_id: parent,
	message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: output }] },
});
export const done = (result: string) => ({
	type: "result",
	subtype: "success",
	is_error: false,
	num_turns: 1,
	result,
	total_cost_usd: 0.01,
	usage: { input_tokens: 10, output_tokens: 5 },
});

/**
 * Three turns: a message with a steer, streamed blocks, a sub-agent's work inside its Task card and
 * an edit; a `/compact` turn whose one-word "Compacted" reply Conductor hides; and a short reply.
 */
export const KNOWN_CHAT: readonly ChatTurnRows[] = [
	{
		turnId: "t-1",
		rows: [
			said("Please fix the failing test."),
			wrote(
				assistant("u-think", [{ type: "thinking", thinking: "Read it first.", signature: "" }]),
			),
			wrote(text("u-1", "I will read the test first.")),
			wrote(toolUse("tu-1", "Read", { file_path: "src/a.test.ts" })),
			wrote(toolResult("tu-1", "expect(sum(1, 1)).toBe(3);")),
			said("Also check the other test."),
			wrote(toolUse("tu-task", "Task", { description: "Check b", prompt: "Check b.test.ts" })),
			wrote(text("u-sub-1", "Looking at the other test.", "tu-task")),
			wrote(toolUse("tu-grep", "Grep", { pattern: "sum" }, "tu-task")),
			wrote(toolResult("tu-grep", "b.test.ts:3", "tu-task")),
			wrote(toolResult("tu-task", "The other test passes.")),
			wrote(
				toolUse("tu-2", "Edit", { file_path: "src/a.test.ts", old_string: "3", new_string: "2" }),
			),
			wrote(toolResult("tu-2", "The file was edited.")),
			wrote(text("u-2", "Fixed. The test passes now.")),
			wrote(done("Fixed. The test passes now.")),
		],
	},
	{
		turnId: "t-2",
		rows: [
			said("/compact"),
			wrote({ type: "system", subtype: "status", status: "compacting", session_id: "claude-1" }),
			wrote({
				type: "system",
				subtype: "compact_boundary",
				session_id: "claude-1",
				compact_metadata: { trigger: "manual", pre_tokens: 1000 },
			}),
			wrote(text("u-3", "Compacted")),
			wrote(done("")),
		],
	},
	{
		turnId: "t-3",
		rows: [said("Thanks!"), wrote(text("u-4", "Glad to help.")), wrote(done("Glad to help."))],
	},
];

/** The time of the `second`-th row: one second apart from 2026-01-02 03:00:00 UTC. */
export function rowTime(second: number): string {
	return new Date(Date.UTC(2026, 0, 2, 3, 0, 0) + second * 1000).toISOString();
}

/**
 * The `session_messages` rows of one chat. Each turn id is prefixed with the chat id, as Conductor's
 * turn ids are unique across chats. `start` is the send time's first second.
 */
export function conductorChatRows(
	chatId: string,
	turns: readonly ChatTurnRows[],
	start = 0,
): Record<string, string>[] {
	let second = start;
	let index = 0;
	return turns.flatMap((turn) =>
		turn.rows.map((row) => {
			const at = rowTime(second++);
			return {
				id: `${chatId}-m-${index++}`,
				session_id: chatId,
				role: row.role,
				content: row.role === "user" ? row.text : JSON.stringify(row.payload),
				created_at: at,
				sent_at: at,
				turn_id: `${chatId}-${turn.turnId}`,
			};
		}),
	);
}

/**
 * A long chat: `turns` turns of a message, a call and its result, a reply and the result, each
 * `rowsPerTurn` rows at least 5, padded with tool calls. `filler` characters of output per call
 * make the rows the size real tool output gives them.
 */
export function manyTurns(turns: number, rowsPerTurn = 5, filler = 0): ChatTurnRows[] {
	const output = "x".repeat(filler);
	return Array.from({ length: turns }, (_, turn) => {
		const calls = Math.max(1, Math.floor((rowsPerTurn - 3) / 2));
		const rows: ChatRow[] = [said(`Message ${turn}`)];
		for (let call = 0; call < calls; call++) {
			const id = `tu-${turn}-${call}`;
			rows.push(wrote(toolUse(id, "Read", { file_path: `src/${call}.ts` })));
			rows.push(wrote(toolResult(id, output)));
		}
		rows.push(wrote(text(`u-${turn}`, `Reply ${turn}`)), wrote(done(`Reply ${turn}`)));
		return { turnId: `t-${turn}`, rows };
	});
}
