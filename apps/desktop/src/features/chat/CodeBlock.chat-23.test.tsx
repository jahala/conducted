/**
 * @feature CHAT-23 Run button on shell code blocks
 * Owns: tests over the real container that a shell code block's Run button starts its command and
 * shows the run's status and exit code, and that only an allowed shell block offers Run.
 * Behaviour: inventory text R@8061041 (Run on shell blocks), ui-map.md 3.3.
 * Test first: a bash block with Run enabled starts its command and shows Done with its exit code.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { CodeBlock } from "./CodeBlock.tsx";

const containers: TestContainer[] = [];

afterEach(async () => {
	cleanup();
	for (const test of containers.splice(0)) {
		await test.container.stop();
		test.close();
	}
});

async function readyWorkspace(test: TestContainer) {
	const workspace = await seedWorkspace(test.container);
	await test.container.platform.fs.mkdirp(workspace.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
		workspace.id,
	]);
	await test.container.services.workspace.start();
	return workspace;
}

describe("CHAT-23 shell code block in the real container", () => {
	it("runs the block's command and shows Done with its exit code", async () => {
		const test = createTestContainer();
		containers.push(test);
		const workspace = await readyWorkspace(test);

		render(
			<ServicesProvider container={test.container}>
				<CodeBlock code={"echo hello"} language={"bash"} workspaceId={workspace.id} canRun />
			</ServicesProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Run" }));

		await waitFor(() => expect(screen.getByText("Done")).toBeTruthy());
		expect(screen.getByText("Exit code 0")).toBeTruthy();
		expect(test.memory.controls.ptySpawns.at(-1)).toMatchObject({
			cwd: workspace.path,
			command: { program: "/bin/zsh", args: ["-l", "-c", "echo hello"] },
		});
	});

	it("offers Run on a long block only once the whole command is shown, then runs all of it", async () => {
		const test = createTestContainer();
		containers.push(test);
		const workspace = await readyWorkspace(test);
		const code = `echo start\n${"echo filler-line\n".repeat(300)}echo hidden-tail`;
		expect(code.length).toBeGreaterThan(5_000);

		render(
			<ServicesProvider container={test.container}>
				<CodeBlock code={code} language={"bash"} workspaceId={workspace.id} canRun />
			</ServicesProvider>,
		);

		expect(screen.queryByText(/hidden-tail/)).toBeNull();
		expect(screen.queryByRole("button", { name: "Run" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Show all" }));
		expect(screen.getByText(/hidden-tail/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Run" }));

		await waitFor(() => expect(screen.getByText("Done")).toBeTruthy());
		expect(test.memory.controls.ptySpawns.at(-1)).toMatchObject({
			command: { program: "/bin/zsh", args: ["-l", "-c", code] },
		});
	});

	it("offers Run only for a shell block the workspace allows", async () => {
		const test = createTestContainer();
		containers.push(test);
		const workspace = await readyWorkspace(test);

		const view = render(
			<ServicesProvider container={test.container}>
				<CodeBlock code={"const a = 1;"} language={"ts"} workspaceId={workspace.id} canRun />
			</ServicesProvider>,
		);
		expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
		view.unmount();

		render(
			<ServicesProvider container={test.container}>
				<CodeBlock code={"echo hello"} language={"bash"} workspaceId={workspace.id} />
			</ServicesProvider>,
		);
		expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
	});
});
