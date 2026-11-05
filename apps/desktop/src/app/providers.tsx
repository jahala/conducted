/**
 * @feature APP-01 App providers
 * Owns: the React providers every screen needs: the query client and the toast host.
 * Behaviour: services-map.md 2.5 (query cache; Conductor keeps one client for the whole app).
 * Our design choice: the query client is made by `createQueryClient()` and passed in, so tests build their own.
 * The default options come from `query-options.ts`: no retries, no refetch on window focus and no staleness on
 * its own, because services own freshness through their stores. Queries that refresh themselves spread the
 * shared preset from the same file.
 * Must handle: the client is created once per app, not per render; toasts render outside the router.
 * Test first: children render inside the provider and can read the client.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "../ui/Toast.tsx";
import { queryClientDefaults } from "./query-options.ts";

export function createQueryClient(): QueryClient {
	return new QueryClient({ defaultOptions: { queries: queryClientDefaults } });
}

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
	return (
		<QueryClientProvider client={client}>
			{children}
			<Toaster />
		</QueryClientProvider>
	);
}
