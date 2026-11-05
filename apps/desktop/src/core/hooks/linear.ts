/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the Linear hooks. The access state comes from the Linear service store.
 * Behaviour: services-map.md 2.5; core/hooks.ts states the contract.
 * Must handle: access that has not been checked yet.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import type { Queries } from "../api.ts";

export const useLinearAccess: Queries["useLinearAccess"] = () => notImplemented("PR-09");
