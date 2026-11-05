/**
 * @feature PLAT-13 Self-update that waits until agents are idle
 * Owns: tests for the quit check of the updates service.
 * Test first: quitting is safe only while no chat is working.
 */
import { describe, expect, it } from "vitest";
import { UpdatesService, type UpdatesServiceDeps } from "./updates.ts";

function serviceWith(working: { value: boolean }): UpdatesService {
	return new UpdatesService({
		platform: {} as UpdatesServiceDeps["platform"],
		anyChatWorking: () => working.value,
		setting: (() => undefined) as unknown as UpdatesServiceDeps["setting"],
	});
}

describe("PLAT-13 UpdatesService.isSafeToQuit", () => {
	it("is safe to quit when no chat works and unsafe while one does", () => {
		const working = { value: false };
		const service = serviceWith(working);
		expect(service.isSafeToQuit()).toBe(true);
		working.value = true;
		expect(service.isSafeToQuit()).toBe(false);
		working.value = false;
		expect(service.isSafeToQuit()).toBe(true);
	});
});
