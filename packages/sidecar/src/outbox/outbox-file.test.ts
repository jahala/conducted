import { expect, test } from "bun:test";
import { fileNameFor, sessionIdFromFileName } from "./outbox-file.ts";

test("a session id with unsafe characters round-trips through a safe file name", () => {
	const name = fileNameFor("a/b ../ü");
	expect(name).not.toContain("/");
	expect(name.endsWith(".json")).toBe(true);
	expect(sessionIdFromFileName(name)).toBe("a/b ../ü");
});

test("files that are not outbox files are ignored", () => {
	expect(sessionIdFromFileName("notes.txt")).toBeNull();
	expect(sessionIdFromFileName("a b.json")).toBeNull();
});
