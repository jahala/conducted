/**
 * @feature DATA-01 Dependencies shared by all repositories
 * Owns: the one small type that says what a repository may use besides the database.
 * Behaviour: the architecture rule "dependencies are parameters" in CLAUDE.md.
 * Must handle: nothing at runtime. Repositories read time and new ids only through these two
 * values, so tests can pass fixed ones.
 * Test first: none, this file holds a type only.
 */
import type { Clock, IdSource } from "@conducted/shared";

export interface RepositoryDeps {
	clock: Clock;
	ids: IdSource;
}
