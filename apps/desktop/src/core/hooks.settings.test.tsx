/**
 * @feature SET-01 Settings registry
 * Owns: the `useSetting` hook that reads one effective setting through the settings store.
 * Behaviour: services-map.md 4.2.1 (layers and precedence) and ui-map.md 6 (settings pages read values).
 * Must handle: returning the registry default before settings load, following a value change, and an
 * unknown key returning undefined.
 * Test first: useSetting returns the registry default before settings load.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useSetting } from "./hooks.ts";
import type { SettingsService } from "./services/settings.ts";

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	test.close();
});

const settings = (): SettingsService => test.container.services.settings;

const wrapper = ({ children }: { children: ReactNode }) => (
	<ServicesProvider container={test.container}>{children}</ServicesProvider>
);

describe("SET-01 useSetting", () => {
	it("returns the registry default before settings load", () => {
		const { result } = renderHook(() => useSetting("theme"), { wrapper });
		expect(result.current).toBe("system");
	});

	it("returns the stored value and follows changes to it", () => {
		const service = settings();
		const { result } = renderHook(() => useSetting<boolean>("notifications_enabled"), {
			wrapper,
		});
		expect(result.current).toBe(true);
		act(() => {
			service.store.setState({ loaded: true, values: { notifications_enabled: false } });
		});
		expect(result.current).toBe(false);
	});

	it("returns undefined for a key the registry does not define", () => {
		const { result } = renderHook(() => useSetting("no_such_setting"), { wrapper });
		expect(result.current).toBeUndefined();
	});
});
