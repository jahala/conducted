import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { ConnectionsPage } from "./ConnectionsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mountPage() {
	test = createTestContainer();
	test.memory.controls.setCloudPairing({ paired: false, url: null });
	await test.container.services.settings.start();
	await test.container.services.cloudPairing.start();
	const set = vi.spyOn(test.container.actions.settings, "set");
	render(
		<ServicesProvider container={test.container}>
			<ConnectionsPage />
		</ServicesProvider>,
	);
	return { set, container: test.container };
}

describe("SET-02 ConnectionsPage", () => {
	it("rejects a range whose first port is above its last and does not save", async () => {
		const { set } = await mountPage();
		fireEvent.change(screen.getByLabelText("First port"), { target: { value: "3000" } });
		fireEvent.change(screen.getByLabelText("Last port"), { target: { value: "2000" } });
		fireEvent.click(screen.getByRole("button", { name: "Save port range" }));

		expect(
			screen.getByText("The first port must be lower than or equal to the last port."),
		).toBeTruthy();
		expect(set).not.toHaveBeenCalled();
	});

	it("rejects a range that includes port 22", async () => {
		const { set } = await mountPage();
		fireEvent.change(screen.getByLabelText("First port"), { target: { value: "22" } });
		fireEvent.change(screen.getByLabelText("Last port"), { target: { value: "30" } });
		fireEvent.click(screen.getByRole("button", { name: "Save port range" }));

		expect(screen.getByText(/Port 22 is reserved for SSH/)).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(
			"Port 22 is reserved for SSH. Choose a range that does not include it.",
		);
		expect(set).not.toHaveBeenCalled();
	});

	it("pairs with a Worker URL and a token, then unpairs", async () => {
		const { container } = await mountPage();
		fireEvent.change(screen.getByLabelText("Worker URL"), {
			target: { value: "https://conducted.example.workers.dev/" },
		});
		fireEvent.change(screen.getByLabelText("Pairing token"), {
			target: { value: "32-random-bytes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair" }));

		expect(
			await screen.findByText("Paired with https://conducted.example.workers.dev."),
		).toBeTruthy();
		expect((await container.platform.cloud.status()).ok).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Unpair" }));
		expect(await screen.findByText("Not paired")).toBeTruthy();
	});

	it("shows why a Worker URL was refused and does not pair", async () => {
		const { container } = await mountPage();
		fireEvent.change(screen.getByLabelText("Worker URL"), {
			target: { value: "http://conducted.example.workers.dev" },
		});
		fireEvent.change(screen.getByLabelText("Pairing token"), {
			target: { value: "32-random-bytes" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Pair" }));

		expect(await screen.findByText("A Worker URL must be https and name a host.")).toBeTruthy();
		const status = await container.platform.cloud.status();
		expect(status.ok && status.value.paired).toBe(false);
	});

	it("deploys the Worker from a folder and pairs this Mac", async () => {
		const { container } = await mountPage();
		if (test === undefined) throw new Error("no test container");
		test.memory.controls.files.set(
			"/w/cloud/wrangler.jsonc",
			JSON.stringify({
				name: "conducted-cloud",
				containers: [{ name: "conducted-cloud-sandbox" }],
				r2_buckets: [{ binding: "BACKUPS", bucket_name: "conducted-cloud-backups" }],
			}),
		);
		fireEvent.change(screen.getByLabelText("Worker source folder"), {
			target: { value: "/w/cloud/" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Deploy to Cloudflare" }));

		expect(
			await screen.findByText("Paired with https://conducted-cloud.example.workers.dev."),
		).toBeTruthy();
		expect(test.memory.controls.cloudDeploys).toEqual([
			{
				sourceDir: "/w/cloud",
				workerName: "conducted-cloud",
				bucketName: "conducted-cloud-backups",
				containerApp: "conducted-cloud-sandbox",
			},
		]);
		expect((await container.platform.cloud.status()).ok).toBe(true);
	});
});
