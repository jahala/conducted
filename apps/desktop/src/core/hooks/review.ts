/**
 * @feature REV-03 Review comment query
 * Owns: the review hooks: inline diff comments.
 * Behaviour: services-map.md 1.3 (review store); core/hooks.ts states the contract.
 * Must handle: a review store that has not loaded, and a load that failed.
 * Test first: two overlapping loads leave the newest answer in the store.
 */
import { appError } from "@conducted/shared";
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { DiffComment } from "../model.ts";

export const useDiffComments: Queries["useDiffComments"] = (workspaceId) => {
	const review = useServices().services.review;
	const comments = useStore(review.store, (state) => state.byWorkspace[workspaceId]);
	const error = useStore(review.store, (state) => state.errors[workspaceId]);

	useEffect(() => {
		if (comments === undefined) void review.load(workspaceId);
	}, [review, workspaceId, comments]);

	return useMemo<Loadable<DiffComment[]>>(() => {
		if (error !== undefined) {
			return { state: "error", error: appError(error.code, error.message) };
		}
		if (comments === undefined) return { state: "loading" };
		return { state: "ready", data: [...comments] };
	}, [comments, error]);
};
