/**
 * @feature RUN-04 Browser toolbar
 * Owns: the bar above the preview. Back and forward, reload, the address with the port and path
 * picker, and Open in browser.
 * Behaviour: ui-map.md 3.2, "Tab content: Browser" ("Reload", "Open in browser", "Port and path"
 * picker).
 * Children: PortPathPicker.
 * Must handle: an address that is not a valid URL (inline error, no navigation), loading state on
 * the reload button, no history (back and forward disabled), and Enter in the address field
 * navigating.
 * Test first: typing "localhost:3000/a" and pressing Enter calls onNavigate with
 * "http://localhost:3000/a".
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { useEffect, useId, useState } from "react";
import { Button } from "../../ui/Button.tsx";
import { IconButton } from "../../ui/IconButton.tsx";
import { Input, Label } from "../../ui/Input.tsx";
import { ArrowLeftIcon, ArrowRightIcon, GlobeIcon } from "../../ui/icons.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { PortPathPicker } from "./PortPathPicker.tsx";

export interface BrowserAddress {
	/** The normalized address, with a scheme and no surrounding whitespace. */
	url: string;
	port: number | null;
	/** The preview may draw this page inside the app; it is a local address. */
	localhost: boolean;
}

function isLocalHostname(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1" ||
		hostname === "[::1]"
	);
}

/** Adds http:// when the user typed a bare address, then checks it is a web URL. */
export function parseBrowserAddress(raw: string): Result<BrowserAddress> {
	const trimmed = raw.trim();
	if (trimmed === "") {
		return err(appError("browser_url_invalid", "Enter a web address."));
	}
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
	let url: URL;
	try {
		url = new URL(withScheme);
	} catch (cause) {
		return err(appError("browser_url_invalid", "Enter a web address.", cause));
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return err(appError("browser_url_invalid", "Enter a web address."));
	}
	const defaultPort = url.protocol === "https:" ? 443 : 80;
	const port = url.port === "" ? defaultPort : Number(url.port);
	return ok({
		url: url.toString(),
		port: Number.isInteger(port) ? port : null,
		localhost: isLocalHostname(url.hostname),
	});
}

export interface BrowserToolbarProps {
	url: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	workspacePort: number;
	detectedPorts: number[];
	onNavigate: (url: string) => void;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onOpenExternally: () => void;
}

export function BrowserToolbar({
	url,
	loading,
	canGoBack,
	canGoForward,
	workspacePort,
	detectedPorts,
	onNavigate,
	onBack,
	onForward,
	onReload,
	onOpenExternally,
}: BrowserToolbarProps) {
	const addressId = useId();
	const [draft, setDraft] = useState(url);
	const [error, setError] = useState<string | undefined>();

	useEffect(() => {
		setDraft(url);
	}, [url]);

	const parsed = parseBrowserAddress(url);
	const current = parsed.ok
		? { port: parsed.value.port ?? workspacePort, path: pathOf(parsed.value.url) }
		: null;

	const submit = () => {
		const next = parseBrowserAddress(draft);
		if (!next.ok) {
			setError(next.error.message);
			return;
		}
		setError(undefined);
		setDraft(next.value.url);
		onNavigate(next.value.url);
	};

	return (
		<form
			role="toolbar"
			aria-label="Browser preview"
			className="flex items-center gap-1 border-b border-border px-2 py-1"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<IconButton
				label="Back"
				size="sm"
				icon={<ArrowLeftIcon />}
				disabled={!canGoBack}
				onClick={onBack}
			/>
			<IconButton
				label="Forward"
				size="sm"
				icon={<ArrowRightIcon />}
				disabled={!canGoForward}
				onClick={onForward}
			/>
			<Button variant="ghost" size="sm" loading={loading} onClick={onReload}>
				Reload
			</Button>
			<div className="min-w-0 flex-1">
				<Label htmlFor={addressId} className="sr-only">
					Address
				</Label>
				<Input
					id={addressId}
					aria-label="Address"
					className="w-full"
					value={draft}
					error={error}
					onChange={(event) => {
						setDraft(event.target.value);
						if (error !== undefined) setError(undefined);
					}}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						submit();
					}}
				/>
			</div>
			{current === null ? null : (
				<Popover
					trigger={
						<Button variant="ghost" size="sm">
							Port and path
						</Button>
					}
				>
					<PortPathPicker
						workspacePort={workspacePort}
						detectedPorts={detectedPorts}
						current={current}
						onChange={onNavigate}
					/>
				</Popover>
			)}
			<Button variant="ghost" size="sm" onClick={onOpenExternally}>
				<GlobeIcon className="size-4" />
				Open in browser
			</Button>
		</form>
	);
}

function pathOf(url: string): string {
	const target = new URL(url);
	return `${target.pathname}${target.search}${target.hash}`;
}
