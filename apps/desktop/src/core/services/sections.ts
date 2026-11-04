/**
 * @feature NAV-04 Sidebar sections: pinned, sections, manual order
 * Owns: the user's sidebar sections, which workspaces sit in each, and their order.
 * Behaviour: services-map.md 2.3.5 (navigation sections replaced inside one transaction),
 * ui-map.md 4 (left sidebar) and 3.1 (Workspace actions: pin, move to section, new section),
 * 5.2 (section dialog: name and emoji).
 * Must handle: a workspace sits in at most one section (moving removes the old membership); a
 * deleted section returns its workspaces to the ungrouped list, it never deletes workspaces; a
 * deleted workspace disappears from its section (cascade in the schema); positions stay dense
 * after a move or delete; two moves at once run one after the other; an unknown section id
 * returns an Err.
 * Our design choice: pinning is `workspaces.pinned_at`, not a special section, so one workspace
 * can be pinned and also sit in a section.
 * Test first: placing a workspace in a second section removes it from the first.
 */
import { notImplemented, type Result, type SectionId, type WorkspaceId } from "@conducted/shared";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Database } from "../../platform/platform.ts";
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

export class SectionsService {
	readonly store: StoreApi<SectionsState>;
	readonly #deps: SectionsServiceDeps;

	constructor(deps: SectionsServiceDeps) {
		this.#deps = deps;
		this.store = createStore<SectionsState>(() => ({ loaded: false, sections: [] }));
	}

	start(): Promise<Result<void>> {
		void this.#deps;
		return notImplemented("NAV-04");
	}

	create(_name: string, _emoji: string | null): Promise<Result<Section>> {
		return notImplemented("NAV-04");
	}

	rename(_id: SectionId, _name: string, _emoji: string | null): Promise<Result<void>> {
		return notImplemented("NAV-04");
	}

	remove(_id: SectionId): Promise<Result<void>> {
		return notImplemented("NAV-04");
	}

	/** Moves a workspace into a section (or out, with null) at a position. */
	place(
		_workspaceId: WorkspaceId,
		_sectionId: SectionId | null,
		_position: number,
	): Promise<Result<void>> {
		return notImplemented("NAV-04");
	}

	reorder(_orderedIds: readonly SectionId[]): Promise<Result<void>> {
		return notImplemented("NAV-04");
	}

	setCollapsed(_id: SectionId, _collapsed: boolean): Promise<Result<void>> {
		return notImplemented("NAV-04");
	}
}
