/**
 * @feature NAV-04 Sidebar sections: pinned, sections, manual order
 * Owns: the user's sidebar sections, which workspaces sit in each, and their order.
 * Behaviour: services-map.md 2.3.5 (navigation sections replaced inside one transaction),
 * ui-map.md 4 (left sidebar) and 3.1 (Workspace actions: pin, move to section, new section),
 * 5.2 (section dialog: name and emoji).
 * Must handle: a workspace sits in at most one section (moving removes the old membership); a
 * deleted section returns its workspaces to the ungrouped list, it never deletes workspaces; an
 * unknown section id returns an Err; positions stay dense after a move or delete; two writes at
 * once run one after the other; an older `start` answer never overwrites a newer one.
 * Our design choice: pinning is `workspaces.pinned_at`, not a special section, so one workspace
 * can be pinned and also sit in a section. A move rewrites the target section's members in one
 * transaction, so the positions it writes are the order the user sees.
 * Test first: placing a workspace in a second section removes it from the first.
 */
import {
	appError,
	createKeyedQueue,
	err,
	ok,
	type Result,
	type SectionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Database } from "../../platform/platform.ts";
import { createLatestWins } from "../async/latest-wins.ts";
import type { Repositories } from "../db/repositories.ts";
import type { Section } from "../model.ts";

export interface SectionsState {
	loaded: boolean;
	sections: readonly Section[];
}

export interface SectionsServiceDeps {
	db: Database;
	repos: Pick<Repositories, "sections">;
}

const byPosition = (sections: readonly Section[]): Section[] =>
	[...sections].sort(
		(left, right) => left.position - right.position || left.id.localeCompare(right.id),
	);

const sectionUnknown = () => appError("section_unknown", "That section no longer exists.");

export class SectionsService {
	readonly store: StoreApi<SectionsState>;
	readonly #deps: SectionsServiceDeps;
	/** One write at a time, so two moves cannot read the same member list and undo each other. */
	readonly #writes = createKeyedQueue<"sections">();
	/** A later `start` supersedes an earlier one, whose answer is then dropped. */
	readonly #reads = createLatestWins<"sections">();

	constructor(deps: SectionsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SectionsState>(() => ({ loaded: false, sections: [] }));
	}

	async start(): Promise<Result<void>> {
		const ticket = this.#reads.begin("sections");
		const listed = await this.#deps.repos.sections.list();
		// Only the newest read may change the store. An older answer is still reported to its caller.
		if (this.#reads.isLatest(ticket)) {
			this.#reads.settle(ticket);
			if (listed.ok) {
				this.store.setState({ loaded: true, sections: byPosition(listed.value) });
			}
		}
		return listed.ok ? ok(undefined) : err(listed.error);
	}

	create(name: string, emoji: string | null): Promise<Result<Section>> {
		return this.#writes.run("sections", () => this.#create(name, emoji));
	}

	async #create(name: string, emoji: string | null): Promise<Result<Section>> {
		const ready = await this.#ensureLoaded();
		if (!ready.ok) return ready;
		const created = await this.#deps.repos.sections.create({
			name: name.trim(),
			emoji: emoji === null || emoji.trim() === "" ? null : emoji,
		});
		if (!created.ok) return err(created.error);
		this.store.setState((state) => ({
			...state,
			sections: byPosition([...state.sections, created.value]),
		}));
		return ok(created.value);
	}

	rename(id: SectionId, name: string, emoji: string | null): Promise<Result<void>> {
		return this.#writes.run("sections", () => this.#rename(id, name, emoji));
	}

	async #rename(id: SectionId, name: string, emoji: string | null): Promise<Result<void>> {
		const ready = await this.#ensureLoaded();
		if (!ready.ok) return ready;
		const nextEmoji = emoji === null || emoji.trim() === "" ? null : emoji;
		const written = await this.#deps.repos.sections.rename(id, name.trim(), nextEmoji);
		if (!written.ok) return err(written.error);
		this.store.setState((state) => ({
			...state,
			sections: state.sections.map((section) =>
				section.id === id ? { ...section, name: name.trim(), emoji: nextEmoji } : section,
			),
		}));
		return ok(undefined);
	}

	remove(id: SectionId): Promise<Result<void>> {
		return this.#writes.run("sections", () => this.#remove(id));
	}

	async #remove(id: SectionId): Promise<Result<void>> {
		const ready = await this.#ensureLoaded();
		if (!ready.ok) return ready;
		const removed = await this.#deps.repos.sections.delete(id);
		if (!removed.ok) return err(removed.error);
		// Its members are gone with it; the workspaces themselves stay in the main list.
		const remaining = byPosition(this.store.getState().sections).filter(
			(section) => section.id !== id,
		);
		// Write the remaining sections back in order, so their stored positions stay dense.
		const renumbered =
			remaining.length === 0
				? ok(undefined)
				: await this.#deps.repos.sections.reorder(remaining.map((section) => section.id));
		this.store.setState((state) => ({
			...state,
			sections: renumbered.ok
				? remaining.map((section, position) => ({ ...section, position }))
				: remaining,
		}));
		return renumbered.ok ? ok(undefined) : err(renumbered.error);
	}

	/** Moves a workspace into a section (or out, with null) at a position. */
	place(
		workspaceId: WorkspaceId,
		sectionId: SectionId | null,
		position: number,
	): Promise<Result<void>> {
		return this.#writes.run("sections", () => this.#place(workspaceId, sectionId, position));
	}

	async #place(
		workspaceId: WorkspaceId,
		sectionId: SectionId | null,
		position: number,
	): Promise<Result<void>> {
		const ready = await this.#ensureLoaded();
		if (!ready.ok) return ready;
		const before = this.store.getState().sections;

		if (sectionId === null) {
			const removed = await this.#deps.repos.sections.removeWorkspaceEverywhere(workspaceId);
			if (!removed.ok) return err(removed.error);
			const next = before.map((section) => ({
				...section,
				workspaceIds: section.workspaceIds.filter((id) => id !== workspaceId),
			}));
			// Rewrite the section that lost the member, so its stored positions stay dense.
			const leaving = before.find((section) => section.workspaceIds.includes(workspaceId));
			if (leaving !== undefined) {
				const dense = leaving.workspaceIds.filter((id) => id !== workspaceId);
				const written = await this.#deps.repos.sections.replaceMembers(leaving.id, dense);
				if (!written.ok) {
					this.store.setState({ sections: next });
					return err(written.error);
				}
			}
			this.store.setState({ sections: next });
			return ok(undefined);
		}

		const target = before.find((section) => section.id === sectionId);
		if (target === undefined) return err(sectionUnknown());
		const remaining = target.workspaceIds.filter((id) => id !== workspaceId);
		const index = Math.max(0, Math.min(position, remaining.length));
		const ordered = [...remaining.slice(0, index), workspaceId, ...remaining.slice(index)];
		const written = await this.#deps.repos.sections.replaceMembers(sectionId, ordered);
		if (!written.ok) return err(written.error);
		this.store.setState({
			sections: before.map((section) => {
				if (section.id === sectionId) return { ...section, workspaceIds: ordered };
				return {
					...section,
					workspaceIds: section.workspaceIds.filter((id) => id !== workspaceId),
				};
			}),
		});
		return ok(undefined);
	}

	reorder(orderedIds: readonly SectionId[]): Promise<Result<void>> {
		return this.#writes.run("sections", () => this.#reorder(orderedIds));
	}

	async #reorder(orderedIds: readonly SectionId[]): Promise<Result<void>> {
		const ready = await this.#ensureLoaded();
		if (!ready.ok) return ready;
		const before = this.store.getState().sections;
		if (orderedIds.some((id) => !before.some((section) => section.id === id))) {
			return err(sectionUnknown());
		}
		const written = await this.#deps.repos.sections.reorder(orderedIds);
		if (!written.ok) return err(written.error);
		const byId = new Map(before.map((section) => [section.id, section]));
		const ordered: Section[] = [];
		for (const id of orderedIds) {
			const section = byId.get(id);
			if (section !== undefined) ordered.push(section);
		}
		for (const section of byPosition(before)) {
			if (!ordered.includes(section)) ordered.push(section);
		}
		this.store.setState({
			sections: ordered.map((section, position) => ({ ...section, position })),
		});
		return ok(undefined);
	}

	setCollapsed(id: SectionId, collapsed: boolean): Promise<Result<void>> {
		return this.#writes.run("sections", () => this.#setCollapsed(id, collapsed));
	}

	async #setCollapsed(id: SectionId, collapsed: boolean): Promise<Result<void>> {
		const ready = await this.#ensureLoaded();
		if (!ready.ok) return ready;
		const written = await this.#deps.repos.sections.setCollapsed(id, collapsed);
		if (!written.ok) return err(written.error);
		this.store.setState((state) => ({
			...state,
			sections: state.sections.map((section) =>
				section.id === id ? { ...section, collapsed } : section,
			),
		}));
		return ok(undefined);
	}

	async #ensureLoaded(): Promise<Result<void>> {
		if (this.store.getState().loaded) return ok(undefined);
		return this.start();
	}
}
