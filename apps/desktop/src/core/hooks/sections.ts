/**
 * @feature NAV-04 Sidebar section hook
 * Owns: the hook screens use to read the user's sidebar sections.
 * Behaviour: services-map.md 1.3 (sections store); core/hooks.ts states the contract.
 * Must handle: a sections store that has not loaded (returns a loading state).
 * Test first: a loaded sections store comes back as a ready list.
 */
import { useMemo } from "react";
import { useStore } from "zustand";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { Section } from "../model.ts";

export const useSections: Queries["useSections"] = () => {
	const store = useServices().services.sections.store;
	const loaded = useStore(store, (state) => state.loaded);
	const sections = useStore(store, (state) => state.sections);
	return useMemo<Loadable<Section[]>>(() => {
		if (!loaded) return { state: "loading" };
		return { state: "ready", data: [...sections] };
	}, [loaded, sections]);
};
