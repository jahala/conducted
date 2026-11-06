/**
 * @feature catalogue Seeding a catalogue state outside the browser
 * Owns: building one state's world over a database the caller opened, seeding it the way the catalogue
 * page does (theme setting first, then the state's seed), and reading back every table the seed wrote.
 * Bun tools use it to show the same sample data in another frontend
 * (scripts/conductor-reference/catalogue.ts draws each state in Conductor's own frontend).
 * Behaviour: not applicable, a development tool. It runs the same seeds as main.tsx; the after-step needs
 * the running app, so it is not run here, and the caller says so where it matters.
 * Must handle: a seed that throws stops with the seed's own message.
 * Test first: not applicable; scripts/conductor-reference/catalogue.test.ts seeds every state with it.
 */
import type { Database } from "../platform/platform.ts";
import { setSetting } from "./seeds.ts";
import type { CatalogueState, Scene, Theme } from "./state.ts";
import { CATALOGUE_STATES } from "./states/index.ts";
import { createWorld, type World } from "./world.ts";

export interface SeededState {
	id: string;
	group: string;
	title: string;
	scene: Scene;
	world: World;
	/** Every row of every table, by table name, as the seed left them. */
	tables: Record<string, Record<string, unknown>[]>;
}

/** The catalogue's states, in index order, without seeding any. */
export const catalogueStates = (): readonly Pick<CatalogueState, "id" | "group" | "title">[] =>
	CATALOGUE_STATES.map(({ id, group, title }) => ({ id, group, title }));

/** Every row of every table in the database, by table name. */
export async function readTables(
	database: Database,
): Promise<Record<string, Record<string, unknown>[]>> {
	const names = await database.select<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
	);
	const tables: Record<string, Record<string, unknown>[]> = {};
	for (const { name } of names) {
		tables[name] = await database.select<Record<string, unknown>>(`SELECT * FROM "${name}"`);
	}
	return tables;
}

/** Seeds the state with this id over `database` and returns its scene, world and tables. */
export async function seedState(
	id: string,
	database: Database,
	theme: Theme,
): Promise<SeededState> {
	const state = CATALOGUE_STATES.find((candidate) => candidate.id === id);
	if (state === undefined) throw new Error(`Unknown catalogue state "${id}".`);
	const world = createWorld(database);
	await setSetting(world, "theme", theme);
	const scene = await state.seed(world);
	return {
		id: state.id,
		group: state.group,
		title: state.title,
		scene,
		world,
		tables: await readTables(database),
	};
}
