/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the sidebar section hooks.
 * Behaviour: services-map.md 1.3 (sections store); core/hooks.ts states the contract.
 * Must handle: a sections store that has not loaded.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import type { Queries } from "../api.ts";

export const useSections: Queries["useSections"] = () => notImplemented("NAV-04");
