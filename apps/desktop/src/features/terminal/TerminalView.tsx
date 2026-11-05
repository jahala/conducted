/**
 * @feature RUN-06 TerminalView
 * Owns: one xterm.js terminal bound to a PTY, with find and fit-to-size. Entry point embedded by
 * the scripts panel and by the center tab strip (big terminal mode).
 * Behaviour: ui-map.md 3.7 (Terminal N tabs: xterm.js, "Find in terminal" Cmd+F, "Close
 * terminal" Cmd+W) and 3.2 (terminals can sit in the center, setting "Big terminal mode").
 * Data: useTerminalConnection(terminalId) gives the PTY stream, input, resize and saved history.
 * Children: TerminalSurface, TerminalFindBar, TerminalEndedBanner.
 * Our design choice: the xterm instance outlives React tab switches. The surface layer from
 * ui-map.md 8 ("long-lived DOM outside React tab content") is a platform concern; this component
 * must tolerate being unmounted and mounted again by replaying saved history, not by relying on
 * staying mounted.
 * Must handle: a terminal that has ended (history shown, banner with exit code), a terminal that
 * cannot be found, the PTY failing to spawn, output arriving before the view is ready (buffer it),
 * output faster than rendering (acknowledge bytes only after they are written, for flow control),
 * a resize while hidden (fit on show), find with no matches, paste of large text, and an archived
 * workspace (history only, no input).
 * Test first: output written to a connection before mount appears in the terminal buffer after
 * mount, and bytes are acknowledged once.
 */
import type { TerminalId } from "@conducted/shared";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useActions, useTerminalConnection } from "../../core/hooks.ts";
import type { TerminalConnection, TerminalUnsubscribe } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { TerminalEndedBanner } from "./TerminalEndedBanner.tsx";
import {
	TerminalFindBar,
	type TerminalFindDirection,
	type TerminalFindMatch,
} from "./TerminalFindBar.tsx";
import { TerminalSurface, type TerminalSurfaceHandle } from "./TerminalSurface.tsx";
import {
	DEFAULT_TERMINAL_SCROLLBACK_BYTES,
	resolveTerminalAppearance,
	type TerminalAppearance,
} from "./terminal-theme.ts";

/**
 * Keeps output that arrives before the surface subscribes. The PTY is live as soon as the
 * connection exists, which can be a render before xterm has mounted.
 */
export class BufferedTerminalConnection implements TerminalConnection {
	readonly history: Uint8Array;
	readonly ended: { exitCode: number | null } | null;
	readonly #source: TerminalConnection;
	#unsubscribe: TerminalUnsubscribe | null = null;
	#pending: Uint8Array[] = [];
	readonly #listeners = new Set<(chunk: Uint8Array) => void>();
	#started = false;
	#disposed = false;

	constructor(source: TerminalConnection) {
		this.#source = source;
		this.history = source.history;
		this.ended = source.ended;
	}

	/** Subscribes to the PTY. Called from an effect, never during render. */
	start(): void {
		if (this.#started || this.#disposed) return;
		this.#started = true;
		this.#unsubscribe = this.#source.onData((chunk) => {
			if (this.#listeners.size === 0) {
				this.#pending.push(chunk);
				return;
			}
			for (const listener of [...this.#listeners]) listener(chunk);
		});
	}

	onData(listener: (chunk: Uint8Array) => void): TerminalUnsubscribe {
		this.#listeners.add(listener);
		for (const chunk of this.#pending.splice(0)) listener(chunk);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	write(data: string) {
		return this.#source.write(data);
	}

	resize(cols: number, rows: number) {
		return this.#source.resize(cols, rows);
	}

	ack(bytes: number): void {
		this.#source.ack(bytes);
	}

	onExit(listener: (exitCode: number | null) => void): TerminalUnsubscribe {
		return this.#source.onExit(listener);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe?.();
		this.#pending = [];
		this.#listeners.clear();
	}
}

function StartTerminalBuffer({ buffered }: { buffered: BufferedTerminalConnection }) {
	useEffect(() => {
		buffered.start();
		return () => buffered.dispose();
	}, [buffered]);
	return null;
}

function currentThemeType(): "light" | "dark" {
	if (typeof document === "undefined") return "dark";
	const forced = document.documentElement.dataset.theme;
	if (forced === "light" || forced === "dark") return forced;
	if (typeof window === "undefined") return "dark";
	return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Resolves one of our colour tokens through the browser, so `light-dark()` is applied. */
export function readDocumentColorToken(name: string): string | null {
	if (typeof document === "undefined") return null;
	const probe = document.createElement("span");
	probe.style.color = `var(${name})`;
	probe.style.display = "none";
	document.body.append(probe);
	const value = getComputedStyle(probe).color.trim();
	probe.remove();
	return value.length > 0 && value !== "rgba(0, 0, 0, 0)" ? value : null;
}

function defaultAppearance(): TerminalAppearance | { error: string } {
	const settings = {
		fontFamily: null,
		fontSize: null,
		scrollbackLimitBytes: DEFAULT_TERMINAL_SCROLLBACK_BYTES,
		themeType: currentThemeType(),
	};
	const result = resolveTerminalAppearance(settings, readDocumentColorToken);
	if (!result.ok) return { error: result.error.message };
	return result.value;
}

export interface TerminalViewProps {
	terminalId: TerminalId;
	/** The tab is on screen. Hidden views keep their buffer and fit when shown again. */
	visible?: boolean;
	focusOnMount?: boolean;
	/** Supplied by a caller that already resolved the terminal appearance. */
	appearance?: TerminalAppearance;
	onClose?: () => void;
	onNewTerminal?: () => void;
	canStartNew?: boolean;
	terminalLimit?: number;
}

export function TerminalView({
	terminalId,
	visible = true,
	focusOnMount = false,
	appearance,
	onClose,
	onNewTerminal,
	canStartNew = false,
	terminalLimit,
}: TerminalViewProps) {
	const connection = useTerminalConnection(terminalId);
	const actions = useActions();
	const [pendingLink, setPendingLink] = useState<string | null>(null);
	const source = connection.state === "ready" ? connection.data : null;
	const buffered = useMemo(
		() => (source ? new BufferedTerminalConnection(source) : null),
		[source],
	);

	const resolved = useMemo(() => (appearance ? { appearance } : defaultAppearance()), [appearance]);
	const surfaceRef = useRef<TerminalSurfaceHandle>(null);
	const [findOpen, setFindOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [regex, setRegex] = useState(false);
	const [hasMatch, setHasMatch] = useState<boolean | null>(null);
	const matchRef = useRef<TerminalFindMatch | null>(null);
	const [ended, setEnded] = useState<{ exitCode: number | null } | null>(null);

	useEffect(() => {
		setEnded(source?.ended ?? null);
		if (!source) return;
		return source.onExit((exitCode) => setEnded({ exitCode }));
	}, [source]);

	const search = useCallback(
		(direction: TerminalFindDirection, from: TerminalFindMatch | null) => {
			const surface = surfaceRef.current;
			if (!surface || !query) {
				matchRef.current = null;
				setHasMatch(null);
				return;
			}
			const match = surface.find({ query, caseSensitive, regex }, direction, from);
			matchRef.current = match;
			setHasMatch(match !== null);
		},
		[query, caseSensitive, regex],
	);

	useEffect(() => {
		if (!findOpen) return;
		search("next", null);
	}, [findOpen, search]);

	const changeQuery = (next: string) => {
		matchRef.current = null;
		setQuery(next);
		setHasMatch(next.length === 0 ? null : false);
	};

	const toggle = (option: "caseSensitive" | "regex") => {
		matchRef.current = null;
		if (option === "caseSensitive") setCaseSensitive((value) => !value);
		else setRegex((value) => !value);
	};

	const closeFind = () => {
		setFindOpen(false);
		surfaceRef.current?.focus();
	};

	const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const meta = event.metaKey || event.ctrlKey;
		if (meta && event.key.toLowerCase() === "f") {
			event.preventDefault();
			setFindOpen(true);
			return;
		}
		if (meta && event.key.toLowerCase() === "w" && onClose) {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key === "Escape" && findOpen) {
			event.preventDefault();
			closeFind();
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: xterm's textarea handles the keys; this catches the panel shortcuts that bubble out of it.
		<div
			className="flex h-full min-h-0 w-full flex-col bg-canvas"
			data-terminal-view={terminalId}
			onKeyDown={handleKeyDown}
		>
			<div className="relative min-h-0 flex-1">
				<LoadableView
					value={connection}
					loadingLabel="Loading terminal"
					errorTitle="Couldn't open the terminal"
				>
					{() =>
						buffered && "appearance" in resolved ? (
							<>
								<StartTerminalBuffer buffered={buffered} />
								<TerminalSurface
									ref={surfaceRef}
									connection={buffered}
									appearance={resolved.appearance}
									visible={visible}
									focusOnMount={focusOnMount}
									onOpenLink={setPendingLink}
								/>
							</>
						) : (
							<EmptyState
								title="Couldn't use the terminal colours"
								body={"error" in resolved ? resolved.error : "Try again."}
							/>
						)
					}
				</LoadableView>
				{findOpen ? (
					<TerminalFindBar
						query={query}
						caseSensitive={caseSensitive}
						regex={regex}
						hasMatch={hasMatch}
						onQueryChange={changeQuery}
						onToggle={toggle}
						onNext={() => search("next", matchRef.current)}
						onPrevious={() => search("previous", matchRef.current)}
						onClose={closeFind}
					/>
				) : null}
			</div>
			{ended ? (
				<TerminalEndedBanner
					exitCode={ended.exitCode}
					canStartNew={canStartNew}
					onNewTerminal={() => onNewTerminal?.()}
					terminalLimit={terminalLimit}
				/>
			) : null}
			<Dialog
				open={pendingLink !== null}
				onOpenChange={(open) => {
					if (!open) setPendingLink(null);
				}}
			>
				<DialogContent
					title="Open this terminal link?"
					description={pendingLink ?? undefined}
					size="sm"
				>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="secondary">Cancel</Button>
						</DialogClose>
						<Button
							onClick={() => {
								if (pendingLink) void actions.app.openUrl(pendingLink);
								setPendingLink(null);
							}}
						>
							Open
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
