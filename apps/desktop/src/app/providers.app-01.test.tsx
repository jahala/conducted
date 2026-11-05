/**
 * @feature APP-01 App providers
 * Owns: the query client defaults, the error hooks that write query and mutation failures to the log,
 * the React root error callbacks, and the toast host beside the children.
 * Behaviour: services-map.md 2.5.1 and part 6 (one client, no retries, no staleness on its own, one
 * toaster at the root, failures logged).
 * Test first: children render inside the provider and can read the client.
 */
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "../ui/Toast.tsx";
import {
	AppProviders,
	createQueryClient,
	createRootErrorHandlers,
	redactVariables,
} from "./providers.tsx";

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
});

function ClientProbe({ onClient }: { onClient: (client: QueryClient) => void }) {
	onClient(useQueryClient());
	return <span>child</span>;
}

describe("APP-01 providers", () => {
	it("renders children inside the query client and the toast host", async () => {
		let seen: QueryClient | null = null;
		const client = createQueryClient(() => {});

		render(
			<AppProviders client={client}>
				<ClientProbe onClient={(value) => (seen = value)} />
			</AppProviders>,
		);

		expect(screen.getByText("child")).toBeTruthy();
		expect(seen).toBe(client);

		await act(async () => {
			toast.success("Saved");
		});
		expect(await screen.findByText("Saved")).toBeTruthy();
		expect(document.querySelector("[data-sonner-toaster]")).toBeTruthy();
	});

	it("keeps the client defaults: no retry, always online, never stale on its own", () => {
		const client = createQueryClient(() => {});
		const queries = client.getDefaultOptions().queries;

		expect(queries).toMatchObject({
			retry: false,
			networkMode: "always",
			refetchOnWindowFocus: false,
			staleTime: Number.POSITIVE_INFINITY,
		});
	});

	it("logs a failed query through the query cache", async () => {
		const logs: { message: string; data?: unknown }[] = [];
		const client = createQueryClient((message, data) => logs.push({ message, data }));

		await client
			.fetchQuery({
				queryKey: ["probe"],
				queryFn: async () => {
					throw new Error("query broke");
				},
			})
			.catch(() => undefined);

		await vi.waitFor(() => expect(logs.some((line) => line.message === "Query failed")).toBe(true));
	});

	it("logs a failed mutation with its secret variables redacted", async () => {
		const logs: { message: string; data?: unknown }[] = [];
		const client = createQueryClient((message, data) => logs.push({ message, data }));
		const mutation = client.getMutationCache().build(client, {
			mutationFn: async (_variables: { token: string; text: string }) => {
				throw new Error("mutation broke");
			},
		});

		await expect(mutation.execute({ token: "super-secret", text: "hello" })).rejects.toThrow(
			"mutation broke",
		);

		const entry = logs.find((line) => line.message === "Mutation failed");
		const written = JSON.stringify(entry?.data);
		expect(written).toContain("[redacted]");
		expect(written).toContain("hello");
		expect(written).not.toContain("super-secret");
	});

	it("redacts secret names at any depth", () => {
		expect(
			redactVariables({
				token: "a",
				nested: { apiKey: "b", values: [{ password: "c" }, "keep"] },
			}),
		).toEqual({
			token: "[redacted]",
			nested: { apiKey: "[redacted]", values: [{ password: "[redacted]" }, "keep"] },
		});
	});

	it("writes caught, uncaught and recoverable render errors to the log", () => {
		const logs: { message: string; data?: unknown }[] = [];
		const handlers = createRootErrorHandlers((message, data) => logs.push({ message, data }));
		const info = { componentStack: "at App" };

		handlers.onCaughtError(new Error("caught"), info);
		handlers.onUncaughtError(new Error("uncaught"), info);
		handlers.onRecoverableError(new Error("recoverable"), info);

		expect(logs.map((line) => line.message)).toEqual([
			"React caught error",
			"React uncaught error",
			"React recoverable error",
		]);
		expect(logs[0]).toMatchObject({
			data: { name: "Error", message: "caught", componentStack: "at App" },
		});
	});
});
