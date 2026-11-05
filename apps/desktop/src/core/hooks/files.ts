/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the file hooks: trees, file text, searches and the artifact pages.
 * Behaviour: services-map.md 2.5 (queries for file data); core/hooks.ts states the contract.
 * Must handle: a file that no longer exists, a search that returns nothing.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import type { Queries } from "../api.ts";

export const useFileTree: Queries["useFileTree"] = () => notImplemented("REV-06");
export const useFileContent: Queries["useFileContent"] = () => notImplemented("REV-08");
export const useFileSearch: Queries["useFileSearch"] = () => notImplemented("REV-07");
export const useContentSearch: Queries["useContentSearch"] = () => notImplemented("REV-07");
export const useRepoFileSearch: Queries["useRepoFileSearch"] = () => notImplemented("COMP-04");
export const useArtifacts: Queries["useArtifacts"] = () => notImplemented("REV-10");
