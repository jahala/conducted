/**
 * @feature RUN-04 Preview frame
 * Owns: tests for the frame's load state reports, over real local ports: a closed port, a server
 * that answers, and a server that starts after the frame gave up.
 * Test first: a load failure event produces the failed state with the URL.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PreviewFrame, type PreviewLoadState } from "./PreviewFrame.tsx";

const servers: Server[] = [];

afterEach(async () => {
	cleanup();
	await Promise.all(servers.splice(0).map(close));
});

function close(server: Server): Promise<void> {
	return new Promise((resolve) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close(() => resolve());
	});
}

/** A real HTTP server on a port the system picks. */
function serve(port = 0): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = createServer((_request, response) => {
			response.end("<p>dev server</p>");
		});
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => {
			servers.push(server);
			resolve(server);
		});
	});
}

const portOf = (server: Server): number => (server.address() as AddressInfo).port;

/** A port that was just free: a server took it from the system and closed again. */
async function closedPort(): Promise<number> {
	const server = await serve();
	const port = portOf(server);
	await close(server);
	return port;
}

describe("RUN-04 preview frame", () => {
	it("a load failure event produces the failed state with the URL", async () => {
		const states: PreviewLoadState[] = [];
		const url = `http://127.0.0.1:${await closedPort()}/docs`;
		render(
			<PreviewFrame
				url={url}
				onLoadState={(state) => states.push(state)}
				loadTimeoutMs={60}
				probeIntervalMs={10}
			/>,
		);

		await waitFor(() => expect(states.at(-1)).toEqual({ kind: "failed", reason: "refused", url }));
		expect(screen.queryByTitle("Preview")).toBeNull();
	});

	it("a load finish reports the ready state", async () => {
		const states: PreviewLoadState[] = [];
		const url = `http://127.0.0.1:${portOf(await serve())}`;
		render(<PreviewFrame url={url} onLoadState={(state) => states.push(state)} />);

		const frame = await screen.findByTitle("Preview");
		expect(frame.getAttribute("src")).toBe(url);
		fireEvent.load(frame);

		expect(states.at(-1)).toEqual({ kind: "ready", title: null });
	});

	it("draws the page by itself once a server starts after the frame gave up", async () => {
		const states: PreviewLoadState[] = [];
		const port = await closedPort();
		const url = `http://127.0.0.1:${port}`;
		render(
			<PreviewFrame
				url={url}
				onLoadState={(state) => states.push(state)}
				loadTimeoutMs={60}
				probeIntervalMs={10}
			/>,
		);
		await waitFor(() => expect(states.at(-1)).toEqual({ kind: "failed", reason: "refused", url }));

		await serve(port);

		const frame = await screen.findByTitle("Preview");
		expect(states.at(-1)).toEqual({ kind: "loading" });
		fireEvent.load(frame);
		expect(states.at(-1)).toEqual({ kind: "ready", title: null });
	});
});
