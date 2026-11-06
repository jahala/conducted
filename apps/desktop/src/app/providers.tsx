/**
 * @feature APP-01 App providers
 * Owns: the React providers every screen needs: the query client and the toast host.
 * Behaviour: services-map.md 2.5 (query cache; Conductor keeps one client for the whole app).
 * Our design choice: the query client is made by `createQueryClient(log)` and passed in, so tests build their
 * own. `log` is required: the live app passes `platform.app.writeLog`, and there is no console fallback to hide
 * a failed query in the dev console. The default options come from `query-options.ts`: no retries, no refetch
 * on window focus and no staleness on its own, because services own freshness through their stores. Queries
 * that refresh themselves spread the shared preset from the same file.
 * Redaction is by key name only. A mutation variable such as a chat message body or a file path is written in
 * full. Our design choice: that is acceptable because the local log is the user's own account of their own
 * work, and a message body is what makes a failure diagnosable. Secrets are named, so a key that holds one is
 * replaced before the write.
 * Must handle: the client is created once per app, not per render; toasts render outside the router; a query or
 * mutation failure is written to the log with the mutation's variables redacted.
 * Test first: children render inside the provider and can read the client.
 */
import { messageOf } from "@conducted/shared";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ErrorInfo, ReactNode } from "react";
import { Toaster } from "../ui/Toast.tsx";
import { queryClientDefaults } from "./query-options.ts";

/** Where query and mutation failures go. The app passes its Platform log; tests pass a recorder. */
export type ErrorLogger = (message: string, data?: unknown) => void;

const SENSITIVE_KEY = /pass(word)?|token|secret|api[-_]?key|credential|authorization/i;

/** Replaces the values of keys that name a secret, at any depth, so a log line never holds one. */
export function redactVariables(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
	if (Array.isArray(value)) return value.map((item) => redactVariables(item, seen));
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value)) return "[circular]";
	seen.add(value);
	const redacted: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		redacted[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redactVariables(entry, seen);
	}
	return redacted;
}

export function createQueryClient(log: ErrorLogger): QueryClient {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				log("Query failed", {
					...describeError(error),
					queryKey: redactVariables(query.queryKey),
				});
			},
		}),
		mutationCache: new MutationCache({
			onError: (error, variables, _result, mutation) => {
				log("Mutation failed", {
					...describeError(error),
					mutationKey: redactVariables(mutation.options.mutationKey ?? null),
					variables: redactVariables(variables),
				});
			},
		}),
		defaultOptions: { queries: queryClientDefaults },
	});
}

/** The three root callbacks React 19 calls when rendering fails, writing each to the log. */
export function createRootErrorHandlers(log: ErrorLogger): {
	onCaughtError: (error: unknown, info: ErrorInfo) => void;
	onUncaughtError: (error: unknown, info: ErrorInfo) => void;
	onRecoverableError: (error: unknown, info: ErrorInfo) => void;
} {
	const report = (kind: string) => (error: unknown, info: ErrorInfo) => {
		log(`React ${kind} error`, {
			...describeError(error),
			componentStack: info.componentStack ?? null,
		});
	};
	return {
		onCaughtError: report("caught"),
		onUncaughtError: report("uncaught"),
		onRecoverableError: report("recoverable"),
	};
}

function describeError(error: unknown): { name?: string; message: string } {
	if (error instanceof Error) return { name: error.name, message: error.message };
	return { message: messageOf(error) };
}

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
	return (
		<QueryClientProvider client={client}>
			{children}
			<Toaster />
		</QueryClientProvider>
	);
}
