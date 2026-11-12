/**
 * @feature APP-18 The chat history import's door into the mapping
 * Owns: `ConductorHistoryImports`, which answers `indexConductorHistory`, `mapConductorHistory`
 * and `closeConductorHistory` by holding the one `ConductorHistoryMapper` the app is filling.
 * Behaviour: docs/plans/migrate-from-conductor.md ("Chat history"). The app reads the copy of
 * Conductor's database through the Rust shell and writes our database; this module only maps.
 * Must handle: one mapping is open at a time, because the app imports one chat at a time, so a
 * new `historyId` drops any other: a mapping the app never closed (it stopped mid-way) does not
 * stay; a call for a `historyId` that is not open, an agent the mapping does not handle, a call
 * out of order and a row missing from a read are refusals, never a throw; a refused map drops the
 * mapping, since its translator state is no longer that of the chat; the mapping closes itself
 * when it has named every row; nothing here logs, because the rows hold the user's messages.
 * Test first: the keys, then reads to the end, give the events `mapConductorMessages` gives.
 */
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import type {
	AppToSidecarRequestResult as Answer,
	AppToSidecarRequestParams as Params,
} from "../rpc/types.ts";
import { ConductorHistoryMapper, MAPPED_AGENTS } from "./conductor-history.ts";

const refused = (message: string): AppError => appError("conductor_history_refused", message);

export class ConductorHistoryImports {
	#open: { historyId: string; mapper: ConductorHistoryMapper } | null = null;

	index(params: Params<"indexConductorHistory">): Result<Record<string, never>> {
		if (!MAPPED_AGENTS.has(params.agent)) {
			return err(refused(`The history of a ${params.agent} chat has no mapping yet.`));
		}
		if (this.#open?.historyId !== params.historyId) {
			this.#open = {
				historyId: params.historyId,
				mapper: new ConductorHistoryMapper({ agent: params.agent, config: params.config }),
			};
		}
		const added = this.#open.mapper.addKeys(params.keys);
		return added.ok ? ok({}) : err(refused(added.error));
	}

	map(params: Params<"mapConductorHistory">): Result<Answer<"mapConductorHistory">> {
		const open = this.#open;
		if (open === null || open.historyId !== params.historyId) {
			return err(refused("That chat's history is not being mapped."));
		}
		const fail = (message: string): Result<never> => {
			this.#open = null;
			return err(refused(message));
		};
		let events: Answer<"mapConductorHistory">["events"] = [];
		if (params.rows.length > 0) {
			const mapped = open.mapper.map(params.rows);
			if (!mapped.ok) return fail(mapped.error);
			events = mapped.value;
		}
		const next = open.mapper.nextRead({ rows: params.maxRows, chars: params.maxChars });
		if (!next.ok) return fail(next.error);
		if (next.value === null) this.#open = null;
		return ok({ events, next: next.value });
	}

	close(params: Params<"closeConductorHistory">): Result<Record<string, never>> {
		if (this.#open?.historyId === params.historyId) this.#open = null;
		return ok({});
	}
}
