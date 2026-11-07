/**
 * @feature CLOUD-13 Local copy of cloud data, kept apart by host
 * Owns: the three host columns of a cloud-owned row read as a `Host`, and the SQL that marks a
 * row with its workspace's host and that scopes a query to one host.
 * Behaviour: services-map.md 1.2 (hosts are values and pick the database a record lives in) and
 * 2.6.2 (cache.db is the local mirror of everything that belongs to a remote host). Our design
 * choice: one database (D038), so the host is a filter on the row instead of a second file (D103).
 * Must handle: a row whose host columns are half written is an error Result, never local; a local
 * row has neither URL nor sandbox id and a cloud row has both; the expressions copy the host from
 * the owning workspace, so no caller can mark a row with a host of its own.
 * Test first: a test refuses a cloud row whose host columns are half written.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";

/** The three host columns, in the order `hostFromRow` and `hostToParams` use. */
export const HOST_COLUMNS = "host_kind, host_url, host_vm_id";

/** The three host columns as they are read from a row. */
export interface HostColumns {
	host_kind: Host["kind"];
	host_url: string | null;
	host_vm_id: string | null;
}

/** The host columns as a `Host`. Local has neither URL nor sandbox id, cloud has both. */
export function hostFromRow(row: HostColumns): Result<Host> {
	if (row.host_kind === "local" && row.host_url === null && row.host_vm_id === null) {
		return ok({ kind: "local" });
	}
	if (
		row.host_kind === "cloud" &&
		row.host_url !== null &&
		row.host_url !== "" &&
		row.host_vm_id !== null &&
		row.host_vm_id !== ""
	) {
		return ok({ kind: "cloud", url: row.host_url, vmId: row.host_vm_id });
	}
	return err(
		appError("db.invalid_host", "host_* must be local with no URL or sandbox, or cloud with both"),
	);
}

/** A `Host` as the three host columns, in column order. */
export function hostToParams(host: Host): readonly [Host["kind"], string | null, string | null] {
	return host.kind === "local" ? ["local", null, null] : ["cloud", host.url, host.vmId];
}

/**
 * The `WHERE` clause that keeps one host's rows, with its parameters. `startsAt` is the number of
 * parameters already in the statement, so the first new one is `$startsAt`. A local row is found
 * by its kind; a cloud row also by the Worker and sandbox, so two cloud hosts never share rows.
 */
export function hostFilter(
	host: Host,
	startsAt: number,
): { sql: string; params: readonly unknown[] } {
	if (host.kind === "local") {
		return { sql: `host_kind = $${startsAt}`, params: ["local"] };
	}
	return {
		sql: `host_kind = $${startsAt} AND host_url = $${startsAt + 1} AND host_vm_id = $${startsAt + 2}`,
		params: ["cloud", host.url, host.vmId],
	};
}

/** The three values a row takes from the workspace named by parameter `$idParam`. */
export function workspaceHostExpressions(idParam: number): string {
	return [
		`(SELECT host_kind FROM workspaces WHERE id = $${idParam})`,
		`(SELECT host_url FROM workspaces WHERE id = $${idParam})`,
		`(SELECT host_vm_id FROM workspaces WHERE id = $${idParam})`,
	].join(", ");
}

/** The three values a row takes from the workspace of the chat named by parameter `$idParam`. */
export function sessionHostExpressions(idParam: number): string {
	return [
		`(SELECT w.host_kind FROM sessions s JOIN workspaces w ON w.id = s.workspace_id
			WHERE s.id = $${idParam})`,
		`(SELECT w.host_url FROM sessions s JOIN workspaces w ON w.id = s.workspace_id
			WHERE s.id = $${idParam})`,
		`(SELECT w.host_vm_id FROM sessions s JOIN workspaces w ON w.id = s.workspace_id
			WHERE s.id = $${idParam})`,
	].join(", ");
}
