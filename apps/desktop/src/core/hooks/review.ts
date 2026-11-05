/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the review hooks: inline diff comments.
 * Behaviour: services-map.md 1.3 (review store); core/hooks.ts states the contract.
 * Must handle: a review store that has not loaded.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import type { Queries } from "../api.ts";

export const useDiffComments: Queries["useDiffComments"] = () => notImplemented("REV-03");
