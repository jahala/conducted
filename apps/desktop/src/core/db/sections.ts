/**
 * @feature DATA-01 Repository for the sections and section_members tables
 * Owns: the sidebar sections and which workspaces sit in them, in order.
 * Behaviour: services-map.md 2.3.5 (navigation_sections: replace scope in one immediate
 * transaction). Our tables are simpler: no scopes, no updated_at guard.
 * Must handle: replacing a section's members runs several statements in one transaction;
 * Our design choice: a workspace is in at most one section, so adding it to a section removes it
 * from the others; positions are 0-based and written from the order of a JSON list; deleting a
 * section deletes its members only, never the workspaces; a workspace delete cascades to its
 * member rows.
 * Test first: moving a workspace to another section leaves it in exactly one section.
 */
import { err, ok, type Result, type SectionId, type WorkspaceId } from "@conducted/shared";
import type { Database } from "../../platform/platform.ts";
import type { Section } from "../model.ts";
import type { RepositoryDeps } from "./deps.ts";
import {
	executeStatement,
	fromFlag,
	inTransaction,
	selectRows,
	stringifyJson,
	toFlag,
} from "./row-codec.ts";

export interface SectionRow {
	id: SectionId;
	name: string;
	emoji: string | null;
	position: number;
	collapsed: number;
	created_at: number;
}

export interface SectionMemberRow {
	section_id: SectionId;
	workspace_id: WorkspaceId;
	position: number;
}

/**
 * Builds a section from its row and the member rows. Rows of other sections are ignored, and
 * members are put in position order (ties broken by workspace id so the order is stable).
 */
export function sectionFromRow(row: SectionRow, members: readonly SectionMemberRow[]): Section {
	const own = members
		.filter((member) => member.section_id === row.id)
		.sort(
			(a, b) =>
				a.position - b.position ||
				(a.workspace_id < b.workspace_id ? -1 : a.workspace_id > b.workspace_id ? 1 : 0),
		);
	return {
		id: row.id,
		name: row.name,
		emoji: row.emoji,
		position: row.position,
		collapsed: fromFlag(row.collapsed),
		workspaceIds: own.map((member) => member.workspace_id),
	};
}

/** Parameters for SECTIONS_SQL.insert, in column order. The model has no created time. */
export const sectionToParams = (section: Section, createdAt: number): readonly unknown[] => [
	section.id,
	section.name,
	section.emoji,
	section.position,
	toFlag(section.collapsed),
	createdAt,
];

/** Parameters for SECTIONS_SQL.addMember, in column order. */
export const sectionMemberToParams = (
	sectionId: SectionId,
	workspaceId: WorkspaceId,
	position: number,
): readonly unknown[] => [sectionId, workspaceId, position];

const SECTION_COLUMNS = "id, name, emoji, position, collapsed, created_at";

/** Every statement the repository runs. Parameters are `$1..$n` in order of first appearance. */
export const SECTIONS_SQL = {
	list: `SELECT ${SECTION_COLUMNS} FROM sections ORDER BY position, id`,
	listMembers: `SELECT section_id, workspace_id, position FROM section_members
		ORDER BY section_id, position, workspace_id`,
	get: `SELECT ${SECTION_COLUMNS} FROM sections WHERE id = $1`,
	nextPosition: "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM sections",
	insert: `INSERT INTO sections (${SECTION_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6)`,
	rename: "UPDATE sections SET name = $1, emoji = $2 WHERE id = $3",
	setCollapsed: "UPDATE sections SET collapsed = $1 WHERE id = $2",
	/** `$1` is a JSON list of section ids in their new order. */
	reorder: `UPDATE sections
		SET position = (SELECT CAST(j.key AS INTEGER) FROM json_each($1) j WHERE j.value = sections.id)
		WHERE id IN (SELECT value FROM json_each($1))`,
	delete: "DELETE FROM sections WHERE id = $1",
	addMember: `INSERT INTO section_members (section_id, workspace_id, position)
		VALUES ($1, $2, $3)
		ON CONFLICT (section_id, workspace_id) DO UPDATE SET position = excluded.position`,
	/** Puts a workspace after the last member of a section. */
	addMemberAtEnd: `INSERT INTO section_members (section_id, workspace_id, position)
		SELECT $1, $2, COALESCE(MAX(position), -1) + 1 FROM section_members WHERE section_id = $1
		ON CONFLICT (section_id, workspace_id) DO NOTHING`,
	removeMember: "DELETE FROM section_members WHERE section_id = $1 AND workspace_id = $2",
	removeFromAllSections: "DELETE FROM section_members WHERE workspace_id = $1",
	/**
	 * The three statements below replace a section's membership. `$2` is a JSON list of workspace
	 * ids in the new order. Run them in this order inside one transaction.
	 */
	replaceStep1RemoveOthers: `DELETE FROM section_members
		WHERE section_id = $1 AND workspace_id NOT IN (SELECT value FROM json_each($2))`,
	replaceStep2TakeFromOtherSections: `DELETE FROM section_members
		WHERE section_id <> $1 AND workspace_id IN (SELECT value FROM json_each($2))`,
	replaceStep3WriteOrder: `INSERT INTO section_members (section_id, workspace_id, position)
		SELECT $1, j.value, CAST(j.key AS INTEGER) FROM json_each($2) j WHERE true
		ON CONFLICT (section_id, workspace_id) DO UPDATE SET position = excluded.position`,
} as const;

/** What a caller supplies to add a section. The repository adds id, position and time. */
export type NewSection = Pick<Section, "name" | "emoji">;

export interface SectionRepository {
	/** SECTIONS_SQL.list and SECTIONS_SQL.listMembers, joined in TypeScript with sectionFromRow. */
	list(): Promise<Result<Section[]>>;
	/** SECTIONS_SQL.nextPosition then SECTIONS_SQL.insert, in one transaction. */
	create(input: NewSection): Promise<Result<Section>>;
	/** SECTIONS_SQL.rename. */
	rename(id: SectionId, name: string, emoji: string | null): Promise<Result<void>>;
	/** SECTIONS_SQL.setCollapsed. */
	setCollapsed(id: SectionId, collapsed: boolean): Promise<Result<void>>;
	/** SECTIONS_SQL.reorder with the ids in their new order. */
	reorder(orderedIds: readonly SectionId[]): Promise<Result<void>>;
	/** SECTIONS_SQL.delete. Members go with it; the workspaces stay. */
	delete(id: SectionId): Promise<Result<void>>;
	/**
	 * SECTIONS_SQL.removeFromAllSections then SECTIONS_SQL.addMemberAtEnd (or addMember when a
	 * position is given), in one transaction. Moving to the same section keeps one row.
	 */
	moveWorkspace(
		workspaceId: WorkspaceId,
		toSectionId: SectionId,
		position?: number,
	): Promise<Result<void>>;
	/** SECTIONS_SQL.removeMember. */
	removeWorkspace(sectionId: SectionId, workspaceId: WorkspaceId): Promise<Result<void>>;
	/** SECTIONS_SQL.removeFromAllSections, for a workspace that moves out of every section. */
	removeWorkspaceEverywhere(workspaceId: WorkspaceId): Promise<Result<void>>;
	/**
	 * SECTIONS_SQL.replaceStep1RemoveOthers, replaceStep2TakeFromOtherSections and
	 * replaceStep3WriteOrder, in one transaction. Afterwards the section holds exactly the given
	 * workspaces in the given order.
	 */
	replaceMembers(
		sectionId: SectionId,
		orderedWorkspaceIds: readonly WorkspaceId[],
	): Promise<Result<void>>;
}

export function createSectionRepository(db: Database, deps: RepositoryDeps): SectionRepository {
	const now = (): number => deps.clock.now();
	const write = async (
		target: Database,
		sql: string,
		params: readonly unknown[],
		what: string,
	): Promise<Result<void>> => {
		const result = await executeStatement(target, sql, params, what);
		return result.ok ? ok(undefined) : err(result.error);
	};
	return {
		list: async () => {
			const sections = await selectRows<SectionRow>(db, SECTIONS_SQL.list, [], "Listing sections");
			if (!sections.ok) return err(sections.error);
			const members = await selectRows<SectionMemberRow>(
				db,
				SECTIONS_SQL.listMembers,
				[],
				"Listing section members",
			);
			if (!members.ok) return err(members.error);
			return ok(sections.value.map((row) => sectionFromRow(row, members.value)));
		},
		create: async (input) =>
			inTransaction(db, "Creating a section", async (tx) => {
				const next = await selectRows<{ next: number }>(
					tx,
					SECTIONS_SQL.nextPosition,
					[],
					"Reading the next section position",
				);
				if (!next.ok) return err(next.error);
				const section: Section = {
					id: deps.ids.uuid() as SectionId,
					name: input.name,
					emoji: input.emoji,
					position: next.value[0]?.next ?? 0,
					collapsed: false,
					workspaceIds: [],
				};
				const written = await executeStatement(
					tx,
					SECTIONS_SQL.insert,
					sectionToParams(section, now()),
					"Creating a section",
				);
				return written.ok ? ok(section) : err(written.error);
			}),
		rename: (id, name, emoji) =>
			write(db, SECTIONS_SQL.rename, [name, emoji, id], "Renaming a section"),
		setCollapsed: (id, collapsed) =>
			write(db, SECTIONS_SQL.setCollapsed, [toFlag(collapsed), id], "Collapsing a section"),
		reorder: async (orderedIds) => {
			const json = stringifyJson(orderedIds, "sections.ids");
			if (!json.ok) return err(json.error);
			return write(db, SECTIONS_SQL.reorder, [json.value], "Reordering sections");
		},
		delete: (id) => write(db, SECTIONS_SQL.delete, [id], "Removing a section"),
		moveWorkspace: async (workspaceId, toSectionId, position) =>
			inTransaction(db, "Moving a workspace to a section", async (tx) => {
				const removed = await executeStatement(
					tx,
					SECTIONS_SQL.removeFromAllSections,
					[workspaceId],
					"Moving a workspace to a section",
				);
				if (!removed.ok) return err(removed.error);
				const added = await executeStatement(
					tx,
					position === undefined ? SECTIONS_SQL.addMemberAtEnd : SECTIONS_SQL.addMember,
					position === undefined
						? [toSectionId, workspaceId]
						: [toSectionId, workspaceId, position],
					"Moving a workspace to a section",
				);
				return added.ok ? ok(undefined) : err(added.error);
			}),
		removeWorkspace: (sectionId, workspaceId) =>
			write(
				db,
				SECTIONS_SQL.removeMember,
				[sectionId, workspaceId],
				"Removing a workspace from a section",
			),
		removeWorkspaceEverywhere: (workspaceId) =>
			write(
				db,
				SECTIONS_SQL.removeFromAllSections,
				[workspaceId],
				"Removing a workspace from every section",
			),
		replaceMembers: async (sectionId, orderedWorkspaceIds) => {
			const json = stringifyJson(orderedWorkspaceIds, "section_members.ids");
			if (!json.ok) return err(json.error);
			return inTransaction(db, "Replacing a section's workspaces", async (tx) => {
				for (const sql of [
					SECTIONS_SQL.replaceStep1RemoveOthers,
					SECTIONS_SQL.replaceStep2TakeFromOtherSections,
					SECTIONS_SQL.replaceStep3WriteOrder,
				]) {
					const written = await executeStatement(
						tx,
						sql,
						[sectionId, json.value],
						"Replacing a section's workspaces",
					);
					if (!written.ok) return err(written.error);
				}
				return ok(undefined);
			});
		},
	};
}
