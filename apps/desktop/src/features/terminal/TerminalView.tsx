/**
 * @feature RUN-06 TerminalView
 * Owns: one xterm.js terminal bound to a PTY, with find and fit-to-size. Entry point embedded by
 * the scripts panel and by the center tab strip (big terminal mode).
 * Behaviour: ui-map.md 3.7 (Terminal N tabs: xterm.js, "Find in terminal" Cmd+F, "Close
 * terminal" Cmd+W) and 3.2 (terminals can sit in the center, setting "Big terminal mode").
 * Data: useTerminalConnection(terminalId) gives the PTY stream, input, resize and saved history.
 * Children: TerminalSurface, TerminalFindBar, TerminalEndedBanner.
 * Commands: terminal.new, terminal.close and terminal.find are registered here (RUN-06). They act
 * only on the terminal that has focus, because hidden tabs and the centre surface stay mounted; the
 * panel's keys call the same functions, and the seven keys xterm owns are in terminal-keys.ts.
 * Our design choice: in a centre terminal tab and in the Run tab the view is drawn by the app shell's
 * surface layer (NAV-15, app/surface-registry.tsx, ui-map.md 8), so it stays mounted while another
 * tab or workspace is open. The Scripts panel's Setup and Terminal N tabs mount it directly. Either way it still tolerates being unmounted and mounted again
 * (a workspace switch in the Scripts panel, a restart) by replaying saved history.
 * Must handle: a terminal that has ended (history shown, banner with exit code), a terminal that
 * cannot be found, the PTY failing to spawn, output arriving before the view is ready (buffer it),
 * output faster than rendering (acknowledge bytes only after they are written, for flow control),
 * a resize while hidden (fit on show), and find with no matches.
 * Test first: output written to a connection before mount appears in the terminal buffer after
 * mount, and bytes are acknowledged once.
 */
import type { TerminalId, WorkspaceId } from "@conducted/shared";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { useActions, useSetting, useTerminalConnection, useTerminals } from "../../core/hooks.ts";
import type { TerminalConnection, TerminalUnsubscribe } from "../../core/model.ts";
import { terminalLimit as limitForMode } from "../../core/terminals.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogClose, DialogContent, DialogFooter } from "../../ui/Dialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useThemeType } from "../../ui/use-theme-type.ts";
import { TerminalEndedBanner } from "./TerminalEndedBanner.tsx";
import {
	findPatternError,
	TerminalFindBar,
	type TerminalFindDirection,
	type TerminalFindMatch,
} from "./TerminalFindBar.tsx";
import { TerminalSurface, type TerminalSurfaceHandle } from "./TerminalSurface.tsx";
import { resolveTerminalAppearance, type TerminalAppearance } from "./terminal-theme.ts";

/**
 * Keeps output that arrives before the surface subscribes. A later `start` subscribes again, so
 * StrictMode's development remount does not leave the terminal without a PTY listener.
 */
export class BufferedTerminalConnection implements TerminalConnection {
	readonly history: Uint8Array;
	readonly #source: TerminalConnection;
	#unsubscribe: TerminalUnsubscribe | null = null;
	#pending: Uint8Array[] = [];
	readonly #listeners = new Set<(chunk: Uint8Array) => void>();
	#started = false;

	constructor(source: TerminalConnection) {
		this.#source = source;
		this.history = source.history;
	}

	/** The exit state can change when a finished shell is restarted. */
	get ended(): { exitCode: number | null } | null {
		return this.#source.ended;
	}

	/**
	 * Subscribes to the PTY. Called from an effect, never during render.
	 * Restartable: React's development StrictMode runs every effect's cleanup and setup once more.
	 */
	start(): void {
		if (this.#started) return;
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

	/** Stops listening. A later `start` subscribes again, so StrictMode can remount the effect. */
	dispose(): void {
		this.#started = false;
		this.#unsubscribe?.();
		this.#unsubscribe = null;
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

/** The user's terminal settings and the current theme, resolved into xterm options. */
function useResolvedTerminalAppearance(
	explicit: TerminalAppearance | undefined,
): { appearance: TerminalAppearance } | { error: string } {
	const fontFamily = useSetting<string>("terminal_font_family");
	const fontSize = useSetting<number>("terminal_font_size");
	const scrollbackLimitBytes = useSetting<number>("terminal_scrollback_limit_bytes");
	const themeType = useThemeType();

	return useMemo(() => {
		if (explicit) return { appearance: explicit };
		const result = resolveTerminalAppearance(
			{
				fontFamily: fontFamily?.trim() ? fontFamily : null,
				fontSize: fontSize ?? null,
				scrollbackLimitBytes,
				themeType,
			},
			readDocumentColorToken,
		);
		return result.ok ? { appearance: result.value } : { error: result.error.message };
	}, [explicit, fontFamily, fontSize, scrollbackLimitBytes, themeType]);
}

export interface TerminalViewProps {
	terminalId: TerminalId;
	/** The workspace that owns the terminal; its live terminals decide whether New terminal is allowed. */
	workspaceId: WorkspaceId;
	/** The tab is on screen. Hidden views keep their buffer and fit when shown again. */
	visible?: boolean;
	focusOnMount?: boolean;
	/** Supplied by a caller that already resolved the terminal appearance. */
	appearance?: TerminalAppearance;
	onClose?: () => void;
	onNewTerminal?: () => void;
	/** Overrides the limit the view derives from the workspace's live terminals. */
	canStartNew?: boolean;
	terminalLimit?: number;
}

export function TerminalView({
	terminalId,
	workspaceId,
	visible = true,
	focusOnMount = false,
	appearance,
	onClose,
	onNewTerminal,
	canStartNew,
	terminalLimit,
}: TerminalViewProps) {
	const connection = useTerminalConnection(terminalId);
	const actions = useActions();
	const workspaceTerminals = useTerminals(workspaceId);
	const tabFreakMode = useSetting<boolean>("experimental_tab_freak_mode");
	const [pendingLink, setPendingLink] = useState<string | null>(null);
	const source = connection.state === "ready" ? connection.data : null;
	const buffered = useMemo(
		() => (source ? new BufferedTerminalConnection(source) : null),
		[source],
	);

	const resolved = useResolvedTerminalAppearance(appearance);
	const rootRef = useRef<HTMLDivElement>(null);
	const surfaceRef = useRef<TerminalSurfaceHandle>(null);
	const [findOpen, setFindOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [regex, setRegex] = useState(false);
	const [hasMatch, setHasMatch] = useState<boolean | null>(null);
	const matchRef = useRef<TerminalFindMatch | null>(null);
	const [ended, setEnded] = useState<{ exitCode: number | null } | null>(null);
	const [exitSubscription, setExitSubscription] = useState(0);

	// A restart starts a new shell, so the exit listener is attached again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: exitSubscription only forces that fresh subscription.
	useEffect(() => {
		setEnded(source?.ended ?? null);
		if (!source) return;
		return source.onExit((exitCode) => setEnded({ exitCode }));
	}, [source, exitSubscription]);

	const effectiveLimit = terminalLimit ?? limitForMode(tabFreakMode);
	const liveTerminals =
		workspaceTerminals.state === "ready"
			? workspaceTerminals.data.filter(
					(terminal) => terminal.kind === "terminal" && terminal.endedAt === null,
				).length
			: 0;
	const limitReached = workspaceTerminals.state === "ready" && liveTerminals >= effectiveLimit;
	const startNewAllowed = canStartNew ?? !limitReached;

	// The three registry commands the terminal panel offers act on the terminal the user is in.
	// Several terminal views stay mounted (a hidden tab, the centre surface), so a command invoked
	// from the palette finds the focused one; a key press reaches this view's own key handler below.
	const openFind = () => {
		setFindOpen(true);
		return true;
	};
	const startNewTerminal = () => {
		if (!startNewAllowed || onNewTerminal === undefined) return false;
		onNewTerminal();
		return true;
	};
	const closeTerminal = () => {
		if (onClose === undefined) return false;
		onClose();
		return true;
	};
	const ownsFocus = () => rootRef.current?.contains(document.activeElement) === true;
	useCommandHandler("terminal.new", "area", () => (ownsFocus() ? startNewTerminal() : false));
	useCommandHandler("terminal.close", "area", () => (ownsFocus() ? closeTerminal() : false));
	useCommandHandler("terminal.find", "area", () => (ownsFocus() ? openFind() : false));

	const restart = async () => {
		const result = await actions.terminals.restart(terminalId);
		if (!result.ok) {
			toastError("Couldn't restart the terminal", result.error);
			return;
		}
		setEnded(null);
		setExitSubscription((count) => count + 1);
	};

	const copySelection = (text: string) => {
		void actions.app.copyText(text).then((result) => {
			if (!result.ok) toastError("Couldn't copy the selection", result.error);
		});
	};

	const openPendingLink = () => {
		const url = pendingLink;
		setPendingLink(null);
		if (url === null) return;
		void actions.app.openUrl(url).then((result) => {
			if (!result.ok) toastError("Couldn't open the link", result.error);
		});
	};

	const search = useCallback(
		(direction: TerminalFindDirection, from: TerminalFindMatch | null) => {
			const surface = surfaceRef.current;
			if (!surface || !query || findPatternError({ query, caseSensitive, regex }) !== null) {
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

	const patternError = findOpen ? findPatternError({ query, caseSensitive, regex }) : null;

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
		// Cmd only: Ctrl+W and Ctrl+F belong to the shell, where they delete a word and move forward.
		const meta = event.metaKey && !event.ctrlKey && !event.altKey;
		if (meta && event.key.toLowerCase() === "f") {
			event.preventDefault();
			openFind();
			return;
		}
		if (meta && event.key.toLowerCase() === "w") {
			if (closeTerminal()) event.preventDefault();
			return;
		}
		if (meta && !event.shiftKey && event.key.toLowerCase() === "t") {
			if (startNewTerminal()) event.preventDefault();
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
			ref={rootRef}
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
									ended={ended !== null}
									focusOnMount={focusOnMount}
									onOpenLink={setPendingLink}
									onCopy={copySelection}
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
						patternError={patternError}
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
					canStartNew={startNewAllowed}
					onNewTerminal={onNewTerminal}
					onRestart={() => void restart()}
					terminalLimit={limitReached ? effectiveLimit : undefined}
				/>
			) : null}
			<Dialog
				open={pendingLink !== null}
				onOpenChange={(open) => {
					if (!open) setPendingLink(null);
				}}
			>
				<DialogContent
					title="Open link?"
					description={`Open this terminal link? ${pendingLink ?? ""}`}
					size="sm"
				>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="secondary">Cancel</Button>
						</DialogClose>
						<Button onClick={openPendingLink}>Open</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
