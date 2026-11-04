/**
 * Guard: an applied migration is never edited. `migrations.lock` holds the SHA-256 of every
 * migration that has shipped. A locked file that changed or disappeared fails the check, and a
 * new migration must be added to the lock (`--lock-new`) in the change that adds it.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS_DIR } from "./data-model.ts";
import { type Problem, read } from "./lib.ts";

export const LOCK = `${MIGRATIONS_DIR}/migrations.lock`;

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export function readLock(root: string): Map<string, string> {
	const path = join(root, LOCK);
	const lock = new Map<string, string>();
	if (!existsSync(path)) return lock;
	for (const line of read(path).split("\n")) {
		const [hash, name] = line.trim().split(/\s+/);
		if (hash && name) lock.set(name, hash);
	}
	return lock;
}

const migrationFiles = (root: string): string[] =>
	readdirSync(join(root, MIGRATIONS_DIR))
		.filter((name) => name.endsWith(".sql"))
		.sort();

export function checkMigrations(root: string): Problem[] {
	const lock = readLock(root);
	const files = migrationFiles(root);
	const problems: Problem[] = [];
	for (const [name, hash] of lock) {
		if (!files.includes(name)) {
			problems.push({ guard: "migrations", message: `${name} is locked but was removed` });
		} else if (sha256(read(join(root, MIGRATIONS_DIR, name))) !== hash) {
			problems.push({
				guard: "migrations",
				message: `${name} was edited after it was locked. Add a new migration instead.`,
			});
		}
	}
	for (const name of files) {
		if (!lock.has(name)) {
			problems.push({
				guard: "migrations",
				message: `${name} is not in ${LOCK}: run bun scripts/guards/migrations.ts --lock-new`,
			});
		}
	}
	return problems;
}

if (import.meta.main && process.argv.includes("--lock-new")) {
	const root = join(import.meta.dir, "../..");
	const lock = readLock(root);
	for (const name of migrationFiles(root)) {
		if (!lock.has(name)) lock.set(name, sha256(read(join(root, MIGRATIONS_DIR, name))));
	}
	const body = [...lock].map(([name, hash]) => `${hash}  ${name}`).join("\n");
	writeFileSync(join(root, LOCK), `${body}\n`);
	console.log(`Locked ${lock.size} migration(s) in ${LOCK}`);
}
