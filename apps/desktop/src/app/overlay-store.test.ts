import { beforeEach, describe, expect, it } from "vitest";
import { useOverlayStore } from "./overlay-store.ts";

describe("NAV-08 overlay store", () => {
	beforeEach(() => {
		useOverlayStore.getState().close();
	});

	it("opens one overlay at a time", () => {
		useOverlayStore.getState().show("palette");
		useOverlayStore.getState().show("passport");
		expect(useOverlayStore.getState().open).toBe("passport");
	});

	it("keeps the open overlay open when shown again", () => {
		useOverlayStore.getState().show("palette");
		useOverlayStore.getState().show("palette");
		expect(useOverlayStore.getState().open).toBe("palette");
	});

	it("closes", () => {
		useOverlayStore.getState().show("palette");
		useOverlayStore.getState().close();
		expect(useOverlayStore.getState().open).toBeNull();
	});

	it("does nothing when closing with no overlay open", () => {
		useOverlayStore.getState().close();
		expect(useOverlayStore.getState().open).toBeNull();
	});
});
