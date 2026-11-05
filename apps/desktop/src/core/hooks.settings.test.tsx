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
import { describe, expect, it } from "vitest";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import type { Repositories } from "./db/repositories.ts";
import { useSetting } from "./hooks.ts";
import { type SettingsPlatform, SettingsService, type TomlCodec } from "./services/settings.ts";

const service = (): SettingsService =>
	new SettingsService({
		platform: {} as SettingsPlatform,
		repos: {} as Pick<Repositories, "settings" | "envVars">,
		toml: {} as TomlCodec,
	});

const wrapper =
	(settings: SettingsService) =>
	({ children }: { children: ReactNode }) => (
		<ServicesProvider container={{ services: { settings } } as unknown as Container}>
			{children}
		</ServicesProvider>
	);

describe("SET-01 useSetting", () => {
	it("returns the registry default before settings load", () => {
		const { result } = renderHook(() => useSetting("theme"), {
			wrapper: wrapper(service()),
		});
		expect(result.current).toBe("system");
	});

	it("returns the stored value and follows changes to it", () => {
		const settings = service();
		const { result } = renderHook(() => useSetting<boolean>("notifications_enabled"), {
			wrapper: wrapper(settings),
		});
		expect(result.current).toBe(true);
		act(() => {
			settings.store.setState({ loaded: true, values: { notifications_enabled: false } });
		});
		expect(result.current).toBe(false);
	});

	it("returns undefined for a key the registry does not define", () => {
		const { result } = renderHook(() => useSetting("no_such_setting"), {
			wrapper: wrapper(service()),
		});
		expect(result.current).toBeUndefined();
	});
});
