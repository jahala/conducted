/**
 * @feature NAV-07 Command registry and default shortcuts
 * Owns: the live key-cap hint hook and the hook that reports an unreadable keybinding setting.
 * Behaviour: ui-map.md 5.4 (overrides replace defaults and feed key-cap hints) and 8 (a keycap
 * reads the live binding, so a rebind changes what is shown).
 * Test first: rebinding git.createPr changes the shortcut the hint shows.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useLiveShortcut, useShortcutOverrides } from "./hooks.ts";
import type { SettingsService } from "./services/settings.ts";

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	test.close();
});

const settingsService = (): SettingsService => test.container.services.settings;

const wrapper = ({ children }: { children: ReactNode }) => (
	<ServicesProvider container={test.container}>{children}</ServicesProvider>
);

describe("NAV-07 useLiveShortcut", () => {
	it("shows the default binding, then the rebound one, and null when unbound", () => {
		const settings = settingsService();
		const { result } = renderHook(() => useLiveShortcut("git.createPr"), { wrapper });
		expect(result.current).toBe("⌘⇧P");

		act(() => {
			settings.store.setState({
				loaded: true,
				values: { keybinding_overrides_v1: '{"git.createPr":["Cmd+Alt+P"]}' },
			});
		});
		expect(result.current).toBe("⌥⌘P");

		act(() => {
			settings.store.setState({
				values: { keybinding_overrides_v1: '{"git.createPr":[]}' },
			});
		});
		expect(result.current).toBeNull();
	});

	it("gives a fixed command its shipped binding even when a rebind is saved", () => {
		const settings = settingsService();
		settings.store.setState({
			loaded: true,
			values: { keybinding_overrides_v1: '{"app.quit":["Cmd+Shift+Q"]}' },
		});
		const { result } = renderHook(() => useLiveShortcut("app.quit"), { wrapper });
		expect(result.current).toBe("⌘Q");
	});
});

describe("NAV-07 useShortcutOverrides", () => {
	it("reports unreadable keybinding text instead of hiding it", () => {
		const settings = settingsService();
		const { result } = renderHook(() => useShortcutOverrides(), { wrapper });
		expect(result.current).toEqual({ overrides: {}, error: null });

		act(() => {
			settings.store.setState({
				loaded: true,
				values: { keybinding_overrides_v1: "{" },
			});
		});
		expect(result.current.overrides).toEqual({});
		expect(result.current.error?.code).toBe("shortcut_overrides_invalid");
	});
});
