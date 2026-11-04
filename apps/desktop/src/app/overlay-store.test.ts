import { beforeEach, describe, expect, it } from "vitest";
import { useOverlayStore } from "./overlay-store.ts";

describe("overlay store", () => {
	beforeEach(() => {
		useOverlayStore.getState().close();
	});

	it("opens one overlay at a time", () => {
		useOverlayStore.getState().show("palette");
		useOverlayStore.getState().show("passport");
		expect(useOverlayStore.getState().open).toBe("passport");
	});

	it("closes", () => {
		useOverlayStore.getState().show("palette");
		useOverlayStore.getState().close();
		expect(useOverlayStore.getState().open).toBeNull();
	});
});
