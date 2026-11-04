/**
 * @feature APP-01 App providers
 * Owns: the React providers every screen needs: the query client and the toast host.
 * Behaviour: services-map.md 2.5 (query cache; Conductor keeps one client for the whole app).
 * Our design choice: the query client is made by `createQueryClient()` and passed in, so tests build their own.
 * No retries and no refetch on window focus: services own freshness through their stores, and a failed query
 * shows its designed error state with a retry button instead of retrying silently.
 * Must handle: the client is created once per app, not per render; toasts render outside the router.
 * Test first: children render inside the provider and can read the client.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "../ui/Toast.tsx";

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
	});
}

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
	return (
		<QueryClientProvider client={client}>
			{children}
			<Toaster />
		</QueryClientProvider>
	);
}
