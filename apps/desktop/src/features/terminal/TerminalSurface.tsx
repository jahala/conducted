/**
 * @feature RUN-06 Terminal surface
 * Owns: the React host of one xterm.js Terminal and its fit addon. It creates both in an effect,
 * connects them to a TerminalConnection, and disposes everything on unmount.
 * Behaviour: ui-map.md 3.7 (xterm.js terminals); ui-map.md 6, Appearance ("Terminal font", size) and
 * Advanced ("Scrollback limit").
 * Library reference (checked in node_modules): `Terminal` from "@xterm/xterm" (options include
 * fontFamily, fontSize, scrollback, theme; methods write, resize, onData, dispose) and `FitAddon`
 * from "@xterm/addon-fit" (fit, proposeDimensions).
 * Must handle: fit on mount, on container resize and on becoming visible (debounced, only the
 * newest size is sent to the PTY), replaying history before live output with no duplicated lines,
 * dispose on unmount with no leaked listeners or observers, font or theme changes applied without
 * recreating the terminal, copy and paste with the usual shortcuts, and keyboard focus ring.
 * Test first: mounting then unmounting disposes the terminal and removes the resize observer.
 */
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import type { TerminalConnection } from "../../core/model.ts";
import {
	findInTerminalBuffer,
	type TerminalFindDirection,
	type TerminalFindMatch,
	type TerminalFindOptions,
} from "./TerminalFindBar.tsx";
import type { TerminalAppearance } from "./terminal-theme.ts";

export interface TerminalSurfaceHandle {
	focus(): void;
	clear(): void;
	find(
		options: TerminalFindOptions,
		direction: TerminalFindDirection,
		from: TerminalFindMatch | null,
	): TerminalFindMatch | null;
}

export interface TerminalSurfaceProps {
	connection: TerminalConnection;
	appearance: TerminalAppearance;
	/** The surface is on screen. Fit runs when this turns true. */
	visible: boolean;
	focusOnMount: boolean;
	/** A Cmd-clicked link. The caller asks the user before opening it. */
	onOpenLink?: (url: string) => void;
	ref?: Ref<TerminalSurfaceHandle>;
}

const LINK_PATTERN = /https?:\/\/[^\s"'<>]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)]+$/;

export interface TerminalLink {
	text: string;
	start: number;
	end: number;
}

/** The http and https links on one line, with their 0-based columns. */
export function findTerminalLinks(text: string): TerminalLink[] {
	const links: TerminalLink[] = [];
	for (const match of text.matchAll(LINK_PATTERN)) {
		const found = match[0].replace(TRAILING_PUNCTUATION, "");
		if (!found) continue;
		const start = match.index ?? 0;
		links.push({ text: found, start, end: start + found.length });
	}
	return links;
}

const FIT_DELAY_MS = 50;

const KEY_SEQUENCES: Record<string, string> = {
	"meta+Backspace": "\u0015",
	"meta+ArrowLeft": "\u0001",
	"meta+ArrowRight": "\u0005",
	"alt+ArrowLeft": "\u001bb",
	"alt+ArrowRight": "\u001bf",
};

function sequenceFor(event: KeyboardEvent): string | null {
	if (event.metaKey && event.key === "Backspace") return KEY_SEQUENCES["meta+Backspace"] ?? null;
	if (event.metaKey && event.key === "ArrowLeft") return KEY_SEQUENCES["meta+ArrowLeft"] ?? null;
	if (event.metaKey && event.key === "ArrowRight") return KEY_SEQUENCES["meta+ArrowRight"] ?? null;
	if (event.altKey && event.key === "ArrowLeft") return KEY_SEQUENCES["alt+ArrowLeft"] ?? null;
	if (event.altKey && event.key === "ArrowRight") return KEY_SEQUENCES["alt+ArrowRight"] ?? null;
	return null;
}

export function TerminalSurface({
	connection,
	appearance,
	visible,
	focusOnMount,
	onOpenLink,
	ref,
}: TerminalSurfaceProps) {
	const containerRef = useRef<HTMLElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const scheduleFitRef = useRef<(() => void) | null>(null);
	const visibleRef = useRef(visible);
	const initialAppearance = useRef(appearance);
	const openLinkRef = useRef(onOpenLink);
	openLinkRef.current = onOpenLink;

	useImperativeHandle(
		ref,
		() => ({
			focus: () => terminalRef.current?.focus(),
			clear: () => terminalRef.current?.clear(),
			find: (options, direction, from) => {
				const terminal = terminalRef.current;
				if (!terminal) return null;
				const match = findInTerminalBuffer(terminal.buffer.normal, options, from, direction);
				if (match) {
					terminal.scrollToLine(match.line);
					terminal.select(match.column, match.line, match.length);
				}
				return match;
			},
		}),
		[],
	);

	useEffect(() => {
		visibleRef.current = visible;
		if (visible) scheduleFitRef.current?.();
	}, [visible]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const terminal = new Terminal({
			convertEol: true,
			cursorBlink: true,
			cursorStyle: "block",
			cursorInactiveStyle: "outline",
			lineHeight: 1.2,
			allowProposedApi: true,
			fontFamily: initialAppearance.current.fontFamily,
			fontSize: initialAppearance.current.fontSize,
			scrollback: initialAppearance.current.scrollbackLines,
			theme: initialAppearance.current.theme,
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(container);
		terminalRef.current = terminal;
		fitRef.current = fitAddon;

		if (connection.ended) terminal.options.disableStdin = true;
		if (focusOnMount) terminal.focus();

		const sendSize = terminal.onResize(({ cols, rows }) => {
			if (visibleRef.current) void connection.resize(cols, rows);
		});
		const userInput = terminal.onData((data) => {
			if (connection.ended) return;
			void connection.write(data);
		});

		let live = false;
		const pending: Uint8Array[] = [];
		const writeChunk = (chunk: Uint8Array) => {
			terminal.write(chunk, () => connection.ack(chunk.byteLength));
		};
		terminal.write(connection.history, () => {
			live = true;
			for (const chunk of pending.splice(0)) writeChunk(chunk);
		});
		const output = connection.onData((chunk) => {
			if (live) writeChunk(chunk);
			else pending.push(chunk);
		});
		const exited = connection.onExit(() => {
			terminal.options.disableStdin = true;
		});

		const linkProvider = terminal.registerLinkProvider({
			provideLinks(lineNumber, callback) {
				const line = terminal.buffer.active.getLine(lineNumber - 1);
				if (!line) {
					callback(undefined);
					return;
				}
				const text = line.translateToString(false);
				const links = findTerminalLinks(text).map((link) => ({
					text: link.text,
					range: {
						start: { x: link.start + 1, y: lineNumber },
						end: { x: link.end + 1, y: lineNumber },
					},
					activate: () => openLinkRef.current?.(link.text),
				}));
				callback(links.length > 0 ? links : undefined);
			},
		});

		terminal.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") return true;

			if (event.metaKey && !event.ctrlKey && !event.altKey) {
				const key = event.key.toLowerCase();
				if (key === "c" && terminal.hasSelection()) {
					void navigator.clipboard?.writeText(terminal.getSelection());
					return false;
				}
				if (key === "v" && navigator.clipboard) {
					void navigator.clipboard.readText().then((text) => {
						if (text && !connection.ended) void connection.write(text);
					});
					return false;
				}
				if (key === "k") {
					terminal.clear();
					return false;
				}
			}

			const sequence = sequenceFor(event);
			if (sequence !== null) {
				terminal.input(sequence, false);
				return false;
			}
			return true;
		});

		let fitTimer: ReturnType<typeof setTimeout> | null = null;
		const scheduleFit = () => {
			if (!visibleRef.current) return;
			if (fitTimer !== null) clearTimeout(fitTimer);
			fitTimer = setTimeout(() => {
				fitTimer = null;
				if (!visibleRef.current) return;
				try {
					fitAddon.fit();
				} catch {
					// A hidden or zero-sized container has no usable dimensions yet.
				}
			}, FIT_DELAY_MS);
		};
		scheduleFitRef.current = scheduleFit;

		const observer = new ResizeObserver(scheduleFit);
		observer.observe(container);
		scheduleFit();

		return () => {
			scheduleFitRef.current = null;
			if (fitTimer !== null) clearTimeout(fitTimer);
			observer.disconnect();
			output();
			exited();
			userInput.dispose();
			sendSize.dispose();
			linkProvider.dispose();
			terminal.dispose();
			fitAddon.dispose();
			terminalRef.current = null;
			fitRef.current = null;
		};
	}, [connection, focusOnMount]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) return;
		terminal.options.fontFamily = appearance.fontFamily;
		terminal.options.fontSize = appearance.fontSize;
		terminal.options.scrollback = appearance.scrollbackLines;
		terminal.options.theme = appearance.theme;
		scheduleFitRef.current?.();
	}, [appearance]);

	return (
		<section
			ref={containerRef}
			data-terminal-surface=""
			aria-label="Terminal"
			className="h-full w-full overflow-hidden bg-canvas p-2 focus-within:ring-2 focus-within:ring-focus"
		/>
	);
}
