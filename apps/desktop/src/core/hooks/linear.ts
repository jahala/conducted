/**
 * @feature DATA-01 Query hook contract for screens
 * @feature PR-09 Linear issues: list, link, attach as context
 * Owns: the Linear hooks. The access state comes from the Linear service store.
 * Behaviour: services-map.md 2.5; core/hooks.ts states the contract; ui-map.md 6 (Account's Linear
 * connection).
 * Must handle: access that has not been checked yet (loading), no key stored (signed out) and a
 * key Linear rejected.
 * Test first: a store with no key reports signed out, and a rejected key keeps that state.
 */
import { useMemo } from "react";
import { useStore } from "zustand";
import type { Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { LinearAccess } from "../model.ts";

export const useLinearAccess: Queries["useLinearAccess"] = () => {
	const { services } = useServices();
	const connection = useStore(services.linear.store, (state) => state.connection);
	const account = useStore(services.linear.store, (state) => state.account);
	return useMemo<{ state: "loading" } | { state: "ready"; data: LinearAccess }>(() => {
		if (connection === "unknown") return { state: "loading" };
		if (connection === "not_connected") {
			return { state: "ready", data: { state: "signed_out" } };
		}
		if (connection === "key_rejected") {
			return { state: "ready", data: { state: "key_rejected" } };
		}
		return {
			state: "ready",
			data: {
				state: "signed_in",
				name: account?.name ?? "Linear",
				organization: account?.organization ?? null,
			},
		};
	}, [connection, account]);
};
