/**
 * @feature test support The Rust shell's database commands, answered from a SQL handle
 * Owns: `databaseCommands`, an invoke function that answers the open, execute and select
 * database commands the way database.rs does, from a `SqlDatabase` the test gives, for tests of
 * the Tauri database wrapper's queue and its lazy open.
 * Behaviour: not applicable, test support only.
 * Must handle: the open command runs the test's `open` hook, so a test can count opens or make one fail;
 * any other command rejects, so a test never gets a made-up answer.
 * Test first: the PLAT-02 Tauri database tests open conducted.db through it.
 */
import type { SqlDatabase } from "../platform/queued-database.ts";
import { COMMANDS } from "../platform/tauri.ts";

export function databaseCommands(
	sql: SqlDatabase,
	open: () => Promise<void> = async () => {},
): <T>(command: string, args?: Record<string, unknown>) => Promise<T> {
	return async <T>(command: string, args: Record<string, unknown> = {}): Promise<T> => {
		const query = String(args.query);
		const values = (args.values ?? []) as unknown[];
		switch (command) {
			case COMMANDS.dbOpen:
				return (await open()) as T;
			case COMMANDS.dbExecute:
				return (await sql.execute(query, values)) as T;
			case COMMANDS.dbSelect:
				return sql.select<T>(query, values);
			default:
				throw { code: "unknown_command", message: `The test answers no ${command}.` };
		}
	};
}
