/**
 * @feature REV-08 Whole-file code view
 * Runs the real @pierre/diffs renderer over a Rust and a TypeScript file to prove the whole-file
 * view draws Shiki-coloured tokens, a line number per line, and the user's chosen code theme.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { CodeFileView } from "./CodeFileView.tsx";

afterEach(cleanup);

const RUST = "fn main() {\n    let count = 1;\n}";
const TYPESCRIPT = "const count = 1;\nexport { count };\n";

function wrapper(container: ReturnType<typeof createTestContainer>["container"]) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>
			<ServicesProvider container={container}>{children}</ServicesProvider>
		</QueryClientProvider>
	);
}

function shadowOf(root: ParentNode): string {
	return root.querySelector("diffs-container")?.shadowRoot?.innerHTML ?? "";
}

describe("REV-08 CodeFileView", () => {
	it("colours a Rust file with the Default code theme and numbers every line", async () => {
		const test = createTestContainer();
		try {
			await seedWorkspace(test.container, { path: "/code/workspaces/code-view-rust" });
			const { container } = render(<CodeFileView path="src/main.rs" text={RUST} />, {
				wrapper: wrapper(test.container),
			});
			await waitFor(
				() => {
					const html = shadowOf(container);
					expect(html).toContain("var(--color-code-keyword)");
					expect(html).toContain("var(--color-code-number)");
					const numbers = Array.from(
						container
							.querySelector("diffs-container")
							?.shadowRoot?.querySelectorAll("[data-line-number-content]") ?? [],
					).map((node) => node.textContent);
					expect(numbers).toEqual(["1", "2", "3"]);
				},
				{ timeout: 8_000 },
			);
		} finally {
			test.close();
		}
	}, 20_000);

	it("colours a TypeScript file with the chosen named theme", async () => {
		const test = createTestContainer();
		try {
			await seedWorkspace(test.container, { path: "/code/workspaces/code-view-ts" });
			expect((await test.container.actions.settings.set("code_theme", "catppuccin-latte")).ok).toBe(
				true,
			);
			const { container } = render(<CodeFileView path="src/a.ts" text={TYPESCRIPT} />, {
				wrapper: wrapper(test.container),
			});
			await waitFor(
				() => {
					expect(shadowOf(container)).toMatch(/style="color:#[0-9a-fA-F]{6}"/);
				},
				{ timeout: 8_000 },
			);
		} finally {
			test.close();
		}
	}, 20_000);
});
