import { appError, err, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { FileStat, FileSystem, Platform } from "../../platform/platform.ts";
import { draftFile } from "../app-paths.ts";
import { convertsToAttachment } from "../composer-files.ts";
import {
	ComposerService,
	type ComposerServiceDeps,
	classifyAttachment,
	DRAFT_STORE_LIMIT_BYTES,
} from "./composer.ts";

describe("COMP-01 classifyAttachment", () => {
	it("reads the extension case-insensitively", () => {
		expect(classifyAttachment("shot.PNG")).toBe("image");
		expect(classifyAttachment("notes.md")).toBe("text");
		expect(classifyAttachment("report.pdf")).toBe("file");
	});
	it("treats a name without an extension as a file", () => {
		expect(classifyAttachment("README")).toBe("file");
	});
});

describe("COMP-01 convertsToAttachment", () => {
	it("keeps short text in the editor", () => {
		expect(convertsToAttachment("hello")).toBe(false);
	});
	it("converts text over 5000 characters", () => {
		expect(convertsToAttachment("a".repeat(5_001))).toBe(true);
		expect(convertsToAttachment("a".repeat(5_000))).toBe(false);
	});
	it("converts text over 90 lines", () => {
		expect(convertsToAttachment(Array.from({ length: 91 }, () => "x").join("\n"))).toBe(true);
		expect(convertsToAttachment(Array.from({ length: 90 }, () => "x").join("\n"))).toBe(false);
	});
});

const sessionId = "session-1" as SessionId;

interface FakeFs {
	fs: FileSystem;
	files: Map<string, string>;
	modified: Map<string, number>;
	trashed: Set<string>;
	now: () => number;
	fail: { write: boolean; trash: boolean; mkdirp: boolean; readDir: boolean };
}

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf("/"));

const fakeFs = (): FakeFs => {
	let clock = 1_000;
	const files = new Map<string, string>();
	const modified = new Map<string, number>();
	const trashed = new Set<string>();
	const fail = { write: false, trash: false, mkdirp: false, readDir: false };
	const now = () => clock++;
	const statFor = (path: string): FileStat => {
		const text = files.get(path) ?? "";
		return {
			path,
			isDirectory: false,
			isSymlink: false,
			size: new TextEncoder().encode(text).length,
			modifiedAt: modified.get(path) ?? 0,
		};
	};
	const fs: FileSystem = {
		async readText(path) {
			const text = files.get(path);
			return text === undefined
				? err(appError("fs_not_found", `${path} does not exist.`))
				: ok(text);
		},
		async writeTextAtomic(path, text) {
			if (fail.write) return err(appError("fs_denied", "The draft file could not be written."));
			files.set(path, text);
			modified.set(path, now());
			return ok(undefined);
		},
		async exists(path) {
			return ok(files.has(path));
		},
		async stat(path) {
			return files.has(path) ? ok(statFor(path)) : err(appError("fs_not_found", "missing"));
		},
		async mkdirp() {
			if (fail.mkdirp) return err(appError("fs_denied", "The drafts folder could not be made."));
			return ok(undefined);
		},
		async readDir(path) {
			if (fail.readDir) return err(appError("fs_denied", "The drafts folder could not be read."));
			const entries = [...files.keys()]
				.filter((file) => parentOf(file) === path)
				.map(statFor)
				.sort((left, right) => left.path.localeCompare(right.path));
			return ok(entries);
		},
		async trash(path) {
			if (fail.trash) return err(appError("fs_denied", "The draft file could not be trashed."));
			files.delete(path);
			modified.delete(path);
			trashed.add(path);
			return ok(undefined);
		},
		async registerRoot() {
			return ok(undefined);
		},
		async readBytes() {
			return ok(new Uint8Array());
		},
		async writeBytes() {
			return ok(undefined);
		},
		assetUrl(path: string) {
			return `asset://localhost/${encodeURIComponent(path)}`;
		},
		paths: { home: "/home", appData: "/app", temp: "/tmp", resources: "/resources" },
	};
	return { fs, files, modified, trashed, now, fail };
};

interface Timers {
	callbacks: Map<number, () => void>;
	set: (callback: () => void, ms: number) => () => void;
	flush: () => void;
}

const timers = (): Timers => {
	let next = 1;
	const callbacks = new Map<number, () => void>();
	return {
		callbacks,
		set(callback) {
			const id = next++;
			callbacks.set(id, callback);
			return () => callbacks.delete(id);
		},
		flush() {
			const pending = [...callbacks.values()];
			callbacks.clear();
			for (const callback of pending) callback();
		},
	};
};

/** Waits for every draft write the service started, the event a fixed wait used to guess at. */
const settle = (service: ComposerService): Promise<void> => service.flush();

const harness = () => {
	const fake = fakeFs();
	const clock = timers();
	const deps: ComposerServiceDeps = {
		platform: { fs: fake.fs } as Pick<Platform, "fs" | "dialogs" | "clipboard">,
		repos: {} as ComposerServiceDeps["repos"],
		setDebounce: clock.set,
	};
	return { ...fake, clock, service: new ComposerService(deps), deps };
};

const file = (): string =>
	draftFile({ home: "/h", appData: "/app", temp: "/t", resources: "/r" }, sessionId);

describe("COMP-01 drafts", () => {
	it("loads an empty draft when no file exists and marks it loaded", async () => {
		const { service } = harness();
		const result = await service.loadDraft(sessionId);
		expect(result).toEqual(ok({ text: "", attachmentPaths: [] }));
		expect(service.draftOf(sessionId)).toEqual({ text: "", attachmentPaths: [] });
	});

	it("writes the newest text once after the pause", async () => {
		const { service, clock, files } = harness();
		service.saveDraft(sessionId, { text: "he", attachmentPaths: [] });
		service.saveDraft(sessionId, { text: "hello", attachmentPaths: ["/a.txt"] });
		expect(files.size).toBe(0);
		clock.flush();
		await settle(service);
		expect(JSON.parse(files.get(file()) ?? "")).toEqual({
			text: "hello",
			attachmentPaths: ["/a.txt"],
		});
	});

	it("keeps the draft across a restart", async () => {
		const fake = fakeFs();
		const firstClock = timers();
		const first = new ComposerService({
			platform: { fs: fake.fs } as Pick<Platform, "fs" | "dialogs" | "clipboard">,
			repos: {} as ComposerServiceDeps["repos"],
			setDebounce: firstClock.set,
		});
		first.saveDraft(sessionId, { text: "unsent", attachmentPaths: [] });
		firstClock.flush();
		await settle(first);
		const secondClock = timers();
		const restarted = new ComposerService({
			platform: { fs: fake.fs } as Pick<Platform, "fs" | "dialogs" | "clipboard">,
			repos: {} as ComposerServiceDeps["repos"],
			setDebounce: secondClock.set,
		});
		expect(await restarted.loadDraft(sessionId)).toEqual(
			ok({ text: "unsent", attachmentPaths: [] }),
		);
	});

	it("writes a draft still waiting for its pause when flushed, so a quit keeps the last edit", async () => {
		const { service, clock, files } = harness();
		service.saveDraft(sessionId, { text: "last words", attachmentPaths: [] });
		expect(files.size).toBe(0);

		await service.flush();

		expect(JSON.parse(files.get(file()) ?? "")).toEqual({
			text: "last words",
			attachmentPaths: [],
		});
		// The debounce timer was cancelled, so it cannot write a second time after the stop.
		expect(clock.callbacks.size).toBe(0);
	});

	it("removes the file when the draft becomes empty", async () => {
		const { service, clock, files } = harness();
		service.saveDraft(sessionId, { text: "draft", attachmentPaths: [] });
		clock.flush();
		await settle(service);
		expect(files.has(file())).toBe(true);
		service.saveDraft(sessionId, { text: "", attachmentPaths: [] });
		// The removal starts at once: no debounce is left for the flush below to force.
		expect(clock.callbacks.size).toBe(0);
		await settle(service);
		expect(files.has(file())).toBe(false);
	});

	it("clears the draft and its file after a send", async () => {
		const { service, clock, files } = harness();
		service.saveDraft(sessionId, { text: "sent", attachmentPaths: [] });
		clock.flush();
		await settle(service);
		expect((await service.clearDraft(sessionId)).ok).toBe(true);
		expect(files.has(file())).toBe(false);
		expect(service.store.getState().drafts[sessionId]).toBeUndefined();
	});

	it("reports a draft larger than the store limit instead of dropping it silently", async () => {
		const { service, clock, files } = harness();
		service.saveDraft(sessionId, {
			text: "x".repeat(DRAFT_STORE_LIMIT_BYTES),
			attachmentPaths: [],
		});
		clock.flush();
		await settle(service);
		expect(files.has(file())).toBe(false);
		expect(service.draftOf(sessionId).text).toHaveLength(DRAFT_STORE_LIMIT_BYTES);
		expect(service.store.getState().errors[sessionId]?.code).toBe("draft_too_large");
	});

	it("reports a failed draft write and clears the error after a later success", async () => {
		const { service, clock, fail } = harness();
		fail.write = true;
		service.saveDraft(sessionId, { text: "hello", attachmentPaths: [] });
		clock.flush();
		await settle(service);
		expect(service.store.getState().errors[sessionId]?.code).toBe("fs_denied");

		fail.write = false;
		service.saveDraft(sessionId, { text: "hello again", attachmentPaths: [] });
		clock.flush();
		await settle(service);
		expect(service.store.getState().errors[sessionId]).toBeUndefined();
	});

	it("reports a failed removal after a send", async () => {
		const { service, clock, fail } = harness();
		fail.trash = true;
		service.saveDraft(sessionId, { text: "sent", attachmentPaths: [] });
		clock.flush();
		await settle(service);
		const result = await service.clearDraft(sessionId);
		expect(result.ok).toBe(false);
		expect(service.store.getState().errors[sessionId]?.code).toBe("fs_denied");
	});

	it("moves the oldest other draft to the trash to make room", async () => {
		const { service, clock, files, trashed } = harness();
		const paths = { home: "/h", appData: "/app", temp: "/t", resources: "/r" };
		const oldSession = "session-old" as SessionId;
		const half = Math.floor(DRAFT_STORE_LIMIT_BYTES / 2);
		service.saveDraft(oldSession, { text: "o".repeat(half), attachmentPaths: [] });
		clock.flush();
		await settle(service);
		const oldFile = draftFile(paths, oldSession);
		expect(files.has(oldFile)).toBe(true);
		service.saveDraft(sessionId, { text: "n".repeat(half), attachmentPaths: [] });
		clock.flush();
		await settle(service);
		expect(trashed.has(oldFile)).toBe(true);
	});

	it("reports an unreadable draft instead of losing it silently", async () => {
		const { service, files } = harness();
		files.set(file(), "{not json");
		const result = await service.loadDraft(sessionId);
		expect(result.ok).toBe(false);
	});

	it("does not bring back a cleared draft from a file that is still being removed", async () => {
		const { service, clock } = harness();
		service.saveDraft(sessionId, { text: "sent", attachmentPaths: [] });
		clock.flush();
		await settle(service);

		const clearing = service.clearDraft(sessionId);
		const loaded = await service.loadDraft(sessionId);
		await clearing;

		expect(loaded).toEqual({ ok: true, value: { text: "", attachmentPaths: [] } });
	});

	it("reports a draft that could not be saved because the drafts folder could not be read", async () => {
		const { service, clock, fail, files } = harness();
		fail.readDir = true;
		service.saveDraft(sessionId, { text: "hello", attachmentPaths: [] });
		clock.flush();
		await settle(service);
		expect(files.has(file())).toBe(false);
		expect(service.store.getState().errors[sessionId]?.code).toBe("fs_denied");
	});
});
