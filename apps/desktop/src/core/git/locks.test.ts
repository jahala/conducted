import { describe, expect, it } from "vitest";
import { KeyedMutex, repoLockKey, worktreeLockKey } from "./locks.ts";

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};

describe("GIT-01 KeyedMutex", () => {
	it("runs tasks on one key one after the other", async () => {
		const mutex = new KeyedMutex();
		const log: string[] = [];
		const gate = deferred();
		const first = mutex.run("k", async () => {
			log.push("first:start");
			await gate.promise;
			log.push("first:end");
		});
		const second = mutex.run("k", async () => {
			log.push("second:start");
		});
		await Promise.resolve();
		expect(log).toEqual(["first:start"]);
		gate.resolve();
		await Promise.all([first, second]);
		expect(log).toEqual(["first:start", "first:end", "second:start"]);
	});

	it("lets different keys run together", async () => {
		const mutex = new KeyedMutex();
		const gate = deferred();
		const started: string[] = [];
		const a = mutex.run("a", async () => {
			started.push("a");
			await gate.promise;
		});
		const b = mutex.run("b", async () => {
			started.push("b");
		});
		await b;
		expect(started).toEqual(["a", "b"]);
		gate.resolve();
		await a;
	});

	it("releases the lock when a task fails and drops idle keys", async () => {
		const mutex = new KeyedMutex();
		await expect(
			mutex.run("k", async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await expect(mutex.run("k", async () => "ok")).resolves.toBe("ok");
		await Promise.resolve();
		await Promise.resolve();
		expect(mutex.size).toBe(0);
	});

	it("builds distinct keys for worktrees and repositories", () => {
		expect(worktreeLockKey("/a")).not.toBe(repoLockKey("/a"));
	});
});
