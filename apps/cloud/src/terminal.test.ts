/**
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * Tests the terminal WebSocket's wire protocol and the text mirror the desktop reads through
 * `GetTerminalOutput`, plus the preview capability token. No container: these are the parts the
 * Durable Object builds on, so they run in Cloudflare's local runtime.
 */
import { describe, expect, it } from "vitest";
import {
	base64FromBytes,
	bytesFromBase64,
	parseClientMessage,
	previewToken,
	TerminalMirror,
	TerminalSession,
} from "./terminal.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("CLOUD-09 the terminal wire protocol", () => {
	it("reads a start, input, resize and kill message", () => {
		expect(
			parseClientMessage(
				JSON.stringify({
					type: "start",
					cwd: "/workspace",
					cols: 120,
					rows: 30,
					command: ["/bin/bash", "-l"],
				}),
			),
		).toEqual({
			type: "start",
			cwd: "/workspace",
			cols: 120,
			rows: 30,
			command: ["/bin/bash", "-l"],
			env: undefined,
		});
		expect(parseClientMessage(JSON.stringify({ type: "input", data: "aGk=" }))).toEqual({
			type: "input",
			data: "aGk=",
		});
		expect(parseClientMessage(JSON.stringify({ type: "resize", cols: 80, rows: 24 }))).toEqual({
			type: "resize",
			cols: 80,
			rows: 24,
		});
		expect(parseClientMessage(JSON.stringify({ type: "kill" }))).toEqual({ type: "kill" });
	});

	it("refuses a message it does not understand, with a reason", () => {
		const bad = parseClientMessage("not json");
		expect(bad).toMatchObject({ type: "invalid" });
		expect(parseClientMessage(JSON.stringify({ type: "jump" }))).toMatchObject({
			type: "invalid",
		});
		expect(parseClientMessage(JSON.stringify({ type: "start", cwd: "relative" }))).toMatchObject({
			type: "invalid",
		});
		expect(parseClientMessage(JSON.stringify({ type: "resize", cols: 0, rows: 24 }))).toMatchObject(
			{ type: "invalid" },
		);
	});

	it("round-trips bytes, including text that is not Latin-1", () => {
		const text = "héllo ✓ 日本語";
		expect(decoder.decode(bytesFromBase64(base64FromBytes(encoder.encode(text))))).toBe(text);
	});
});

describe("CLOUD-09 the terminal mirror", () => {
	it("keeps the last lines of what the terminal printed", () => {
		const mirror = new TerminalMirror(4);
		mirror.append(encoder.encode("one\ntwo\n"));
		mirror.append(encoder.encode("three\nfour\nfive"));
		expect(mirror.text()).toBe("two\nthree\nfour\nfive");
	});

	it("counts a carriage return as a line end, as a progress bar does", () => {
		const mirror = new TerminalMirror(3);
		mirror.append(encoder.encode("a\rb\rc\r"));
		expect(mirror.text()).toBe("a\nb\nc");
	});
});

describe("CLOUD-09 a terminal session", () => {
	const fakeProcess = () => {
		const output = new TransformStream<Uint8Array, Uint8Array>();
		const writer = output.writable.getWriter();
		let stdinText = "";
		const stdin = new WritableStream<Uint8Array>({
			write: (chunk) => {
				stdinText += decoder.decode(chunk);
			},
		});
		const resizes: { cols: number; rows: number }[] = [];
		let killed = false;
		let resolveExit: (code: number) => void = () => {};
		const process = {
			stdin,
			stdout: output.readable,
			exitCode: new Promise<number>((resolve) => {
				resolveExit = resolve;
			}),
			kill: () => {
				killed = true;
				resolveExit(0);
			},
			resize: (cols: number, rows: number) => {
				resizes.push({ cols, rows });
			},
		};
		return {
			process,
			writer,
			stdin: () => stdinText,
			resizes,
			killed: () => killed,
			exit: (code: number) => resolveExit(code),
		};
	};

	const session = (
		process: ReturnType<typeof fakeProcess>["process"],
		events: { type: string; [key: string]: unknown }[],
	) =>
		new TerminalSession(
			(message) => {
				events.push(message as { type: string });
			},
			async () => process,
			() => {},
		);

	it("starts the process and streams its output", async () => {
		const fake = fakeProcess();
		const events: { type: string; [key: string]: unknown }[] = [];
		const live = session(fake.process, events);
		await live.receive(JSON.stringify({ type: "start", cwd: "/workspace" }));
		await fake.writer.write(encoder.encode("hello"));
		fake.exit(0);
		await fake.writer.close();
		await live.settled();
		expect(events[0]).toEqual({ type: "ready" });
		expect(decoder.decode(bytesFromBase64(events[1]?.data as string))).toBe("hello");
	});

	it("sends input, resizes and kills", async () => {
		const fake = fakeProcess();
		const events: { type: string; [key: string]: unknown }[] = [];
		const live = session(fake.process, events);
		await live.receive(JSON.stringify({ type: "start", cwd: "/workspace" }));
		await live.receive(
			JSON.stringify({ type: "input", data: base64FromBytes(encoder.encode("ls")) }),
		);
		await live.receive(JSON.stringify({ type: "resize", cols: 100, rows: 40 }));
		await live.receive(JSON.stringify({ type: "kill" }));
		expect(fake.stdin()).toBe("ls");
		expect(fake.resizes).toEqual([{ cols: 100, rows: 40 }]);
		expect(fake.killed()).toBe(true);
	});

	it("reports the exit code and then refuses more input", async () => {
		const fake = fakeProcess();
		const events: { type: string; [key: string]: unknown }[] = [];
		const live = session(fake.process, events);
		await live.receive(JSON.stringify({ type: "start", cwd: "/workspace" }));
		fake.exit(7);
		await fake.writer.close();
		await live.settled();
		expect(events.at(-1)).toEqual({ type: "exit", exitCode: 7 });
		await live.receive(JSON.stringify({ type: "input", data: "aGk=" }));
		expect(fake.stdin()).toBe("");
	});
});

describe("CLOUD-09 preview tokens", () => {
	it("gives each workspace and port its own unguessable token", async () => {
		const first = await previewToken("secret", "oslo", 3000);
		expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await previewToken("secret", "oslo", 3000)).toBe(first);
		expect(await previewToken("secret", "oslo", 3001)).not.toBe(first);
		expect(await previewToken("secret", "oslo-2", 3000)).not.toBe(first);
		expect(await previewToken("other", "oslo", 3000)).not.toBe(first);
	});
});
