// @vitest-environment node
/**
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * Tests the pairing service over the real container: it loads the saved pairing, refuses input the
 * Worker could never accept, keeps a good pairing, and removes it again.
 */
import { describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

const UP = { paired: true, url: "https://conducted.example.workers.dev" };

function ready(): TestContainer {
	const test = createTestContainer();
	return test;
}

describe("CLOUD-07 the pairing service", () => {
	it("reports the saved pairing at startup", async () => {
		const test = ready();
		try {
			test.memory.controls.setCloudPairing({ paired: false, url: null });
			expect((await test.container.services.cloudPairing.start()).ok).toBe(true);
			expect(test.container.services.cloudPairing.store.getState()).toEqual({
				state: "ready",
				pairing: { paired: false, url: null },
			});
		} finally {
			test.close();
		}
	});

	it("refuses a plain-http URL and a blank token without touching the saved pairing", async () => {
		const test = ready();
		try {
			test.memory.controls.setCloudPairing(UP);
			await test.container.services.cloudPairing.start();
			const badUrl = await test.container.services.cloudPairing.pair({
				url: "http://conducted.example.workers.dev",
				token: "token",
			});
			expect(badUrl.ok).toBe(false);
			const badToken = await test.container.services.cloudPairing.pair({
				url: UP.url,
				token: "   ",
			});
			expect(badToken.ok).toBe(false);
			expect(test.container.services.cloudPairing.store.getState()).toEqual({
				state: "ready",
				pairing: UP,
			});
		} finally {
			test.close();
		}
	});

	it("is reachable from the actions table the screens call", async () => {
		const test = ready();
		try {
			test.memory.controls.setCloudPairing({ paired: false, url: null });
			await test.container.services.cloudPairing.start();
			const paired = await test.container.actions.cloud.pair({
				url: UP.url,
				token: "token",
			});
			expect(paired.ok).toBe(true);
			expect((await test.memory.platform.cloud.status()).ok).toBe(true);
			expect((await test.container.actions.cloud.unpair()).ok).toBe(true);
		} finally {
			test.close();
		}
	});

	it("keeps a good pairing, normalized, and removes it on unpair", async () => {
		const test = ready();
		try {
			test.memory.controls.setCloudPairing({ paired: false, url: null });
			await test.container.services.cloudPairing.start();
			const paired = await test.container.services.cloudPairing.pair({
				url: " https://conducted.example.workers.dev/ ",
				token: "  32-random-bytes\n",
			});
			expect(paired.ok).toBe(true);
			if (paired.ok) expect(paired.value).toEqual(UP);
			expect(test.container.services.cloudPairing.store.getState()).toEqual({
				state: "ready",
				pairing: UP,
			});
			expect((await test.memory.platform.cloud.status()).ok).toBe(true);

			expect((await test.container.services.cloudPairing.unpair()).ok).toBe(true);
			expect(test.container.services.cloudPairing.store.getState()).toEqual({
				state: "ready",
				pairing: { paired: false, url: null },
			});
		} finally {
			test.close();
		}
	});
});
