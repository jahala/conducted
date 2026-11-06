/**
 * @feature REV-08 Markdown preview
 * Owns: the rendered view of a Markdown file in the File tab.
 * Behaviour: ui-map.md 3.2 (previews) and 6 (Appearance: "Markdown Style", Default or Tufte).
 * Our design choice: the renderer builds React elements instead of HTML, so scripts and raw HTML
 * in the file never run, and remote images (a scheme such as "https:" or a "//host" address) are
 * shown as links rather than loaded. An inline "data:image/" image is shown, as in the chat.
 * Must handle: relative links (resolved against the file's folder and opened as workspace files),
 * relative images (loaded from the workspace through `imageUrlFor`), a target that climbs out of
 * the workspace or is only an anchor (shown as plain text), fenced code blocks, headings, lists,
 * task lists, tables, blockquotes, inline emphasis and an empty file.
 * Test first: a "<script>" tag in the text is not present in the rendered output.
 */
import type { ReactNode } from "react";
import { cn } from "../../../ui/cn.ts";

export interface MarkdownPreviewProps {
	text: string;
	/** Folder of the file, relative to the workspace, for resolving relative links. */
	baseDir: string;
	style: "default" | "tufte";
	/** Opens a web address outside the app. */
	onOpenLink: (url: string) => void;
	/** Opens a workspace file, by its path relative to the workspace. */
	onOpenFile: (path: string) => void;
	/** The URL to load a workspace image from, or null when none can be made. */
	imageUrlFor: (path: string) => string | null;
}

interface LinkHandlers {
	baseDir: string;
	onOpenLink: (url: string) => void;
	onOpenFile: (path: string) => void;
	imageUrlFor: (path: string) => string | null;
}

/** A web address or another scheme, including a protocol-relative "//host" address. */
const isRemote = (target: string): boolean => /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i.test(target);
const isInlineImage = (target: string): boolean => /^data:image\//i.test(target);

/**
 * A link target as a path relative to the workspace. A leading "/" starts at the workspace root.
 * Null for an anchor alone or a path that climbs out of the workspace.
 */
function resolveWorkspacePath(baseDir: string, target: string): string | null {
	const bare = target.split(/[?#]/)[0] ?? "";
	if (bare.length === 0) return null;
	const segments = bare.startsWith("/") ? [] : baseDir.split("/").filter((part) => part.length > 0);
	for (const part of bare.split("/")) {
		if (part.length === 0 || part === ".") continue;
		if (part === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(part);
	}
	return segments.length === 0 ? null : segments.join("/");
}

function renderImage(at: string, alt: string, target: string, links: LinkHandlers): ReactNode {
	if (isRemote(target) && !isInlineImage(target)) {
		return (
			<button
				key={at}
				type="button"
				className="text-link underline underline-offset-4"
				onClick={() => links.onOpenLink(target)}
			>
				Image: {alt || target}
			</button>
		);
	}
	const resolved = isInlineImage(target) ? null : resolveWorkspacePath(links.baseDir, target);
	const src = isInlineImage(target)
		? target
		: resolved === null
			? null
			: links.imageUrlFor(resolved);
	if (src === null) return <span key={at}>{alt || target}</span>;
	return <img key={at} src={src} alt={alt} loading="lazy" className="max-w-full rounded" />;
}

function renderLink(at: string, label: string, target: string, links: LinkHandlers): ReactNode {
	if (isRemote(target)) {
		return (
			<a
				key={at}
				href={target}
				className="text-link underline underline-offset-4"
				onClick={(event) => {
					event.preventDefault();
					links.onOpenLink(target);
				}}
			>
				{label}
			</a>
		);
	}
	const resolved = resolveWorkspacePath(links.baseDir, target);
	if (resolved === null) return <span key={at}>{label}</span>;
	return (
		<a
			key={at}
			href={resolved}
			className="text-link underline underline-offset-4"
			onClick={(event) => {
				event.preventDefault();
				links.onOpenFile(resolved);
			}}
		>
			{label}
		</a>
	);
}

/** Inline Markdown as React nodes. Raw HTML is shown as text, never parsed into elements. */
function renderInline(text: string, keyPrefix: string, links: LinkHandlers): ReactNode[] {
	const nodes: ReactNode[] = [];
	const pattern =
		/!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_/g;
	let last = 0;
	let match = pattern.exec(text);
	let key = 0;
	while (match !== null) {
		if (match.index > last) nodes.push(text.slice(last, match.index));
		const at = `${keyPrefix}-${key}`;
		key += 1;
		if (match[1] !== undefined && match[2] !== undefined) {
			nodes.push(renderImage(at, match[1], match[2], links));
		} else if (match[3] !== undefined && match[4] !== undefined) {
			nodes.push(renderLink(at, match[3], match[4], links));
		} else if (match[5] !== undefined) {
			nodes.push(
				<code key={at} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-code">
					{match[5]}
				</code>,
			);
		} else if (match[6] !== undefined) {
			nodes.push(<strong key={at}>{match[6]}</strong>);
		} else if (match[7] !== undefined) {
			nodes.push(<s key={at}>{match[7]}</s>);
		} else if (match[8] !== undefined) {
			nodes.push(<em key={at}>{match[8]}</em>);
		} else if (match[9] !== undefined) {
			nodes.push(<em key={at}>{match[9]}</em>);
		}
		last = pattern.lastIndex;
		match = pattern.exec(text);
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}

const isBlank = (line: string): boolean => line.trim().length === 0;
const heading = /^(#{1,6})\s+(.*)$/;
const fence = /^\s*```(\S*)\s*$/;
const unordered = /^\s*[-*+]\s+(.*)$/;
const ordered = /^\s*\d+[.)]\s+(.*)$/;
const tableSeparator = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function tableCells(line: string): string[] {
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
	if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
	return trimmed.split("|").map((cell) => cell.trim());
}

export function MarkdownPreview({
	text,
	baseDir,
	style,
	onOpenLink,
	onOpenFile,
	imageUrlFor,
}: MarkdownPreviewProps) {
	const links: LinkHandlers = { baseDir, onOpenLink, onOpenFile, imageUrlFor };
	const inline = (value: string, keyPrefix: string): ReactNode[] =>
		renderInline(value, keyPrefix, links);
	const lines = text.split("\n");
	const blocks: ReactNode[] = [];
	let index = 0;
	let key = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";
		const at = `md-${key}`;

		if (isBlank(line)) {
			index += 1;
			continue;
		}

		const fenceMatch = fence.exec(line);
		if (fenceMatch !== null) {
			const language = fenceMatch[1] ?? "";
			const body: string[] = [];
			index += 1;
			while (index < lines.length && fence.exec(lines[index] ?? "") === null) {
				body.push(lines[index] ?? "");
				index += 1;
			}
			index += 1;
			blocks.push(
				<pre
					key={at}
					className="overflow-x-auto rounded-md border border-border bg-surface p-3 font-mono text-code"
				>
					<code data-language={language}>{body.join("\n")}</code>
				</pre>,
			);
			key += 1;
			continue;
		}

		const headingMatch = heading.exec(line);
		if (headingMatch !== null) {
			const level = headingMatch[1]?.length ?? 1;
			const Tag = `h${Math.min(Math.max(level, 1), 6)}` as "h1";
			const size =
				level === 1 ? "text-xl" : level === 2 ? "text-lg" : level === 3 ? "text-base" : "text-sm";
			blocks.push(
				<Tag key={at} className={cn("mt-4 font-medium text-fg first:mt-0", size)}>
					{inline(headingMatch[2] ?? "", at)}
				</Tag>,
			);
			index += 1;
			key += 1;
			continue;
		}

		if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
			blocks.push(<hr key={at} className="my-4 border-border" />);
			index += 1;
			key += 1;
			continue;
		}

		if (tableSeparator.test(lines[index + 1] ?? "") && line.includes("|")) {
			const headerCells = tableCells(line);
			index += 2;
			const bodyRows: string[][] = [];
			while (index < lines.length && (lines[index] ?? "").includes("|")) {
				bodyRows.push(tableCells(lines[index] ?? ""));
				index += 1;
			}
			blocks.push(
				<div key={at} className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border">
								{headerCells.map((cell, cellIndex) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: the column order is the table's order.
									<th key={`${at}-h-${cellIndex}`} className="px-2 py-1 text-left font-medium">
										{inline(cell, `${at}-h-${cellIndex}`)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{bodyRows.map((row, rowIndex) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: the row order is the table's order.
								<tr key={`${at}-r-${rowIndex}`} className="border-b border-border last:border-0">
									{row.map((cell, cellIndex) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: the column order is the table's order.
										<td key={`${at}-r-${rowIndex}-${cellIndex}`} className="px-2 py-1">
											{inline(cell, `${at}-r-${rowIndex}-${cellIndex}`)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>,
			);
			key += 1;
			continue;
		}

		if (line.trimStart().startsWith(">")) {
			const quoted: string[] = [];
			while (index < lines.length && (lines[index] ?? "").trimStart().startsWith(">")) {
				quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
				index += 1;
			}
			blocks.push(
				<blockquote key={at} className="border-l-2 border-border-strong pl-3 text-fg-muted">
					{inline(quoted.join(" "), at)}
				</blockquote>,
			);
			key += 1;
			continue;
		}

		if (unordered.test(line)) {
			const items: string[] = [];
			while (index < lines.length && unordered.test(lines[index] ?? "")) {
				items.push(unordered.exec(lines[index] ?? "")?.[1] ?? "");
				index += 1;
			}
			blocks.push(
				<ul key={at} className="list-disc space-y-1 pl-5">
					{items.map((item, itemIndex) => {
						const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: the item order is the list's order.
							<li key={`${at}-${itemIndex}`}>
								{task !== null ? (
									<span className="flex items-start gap-2">
										<input
											type="checkbox"
											checked={task[1]?.toLowerCase() === "x"}
											readOnly
											aria-label="Task done"
											className="mt-1"
										/>
										<span>{inline(task[2] ?? "", `${at}-${itemIndex}`)}</span>
									</span>
								) : (
									inline(item, `${at}-${itemIndex}`)
								)}
							</li>
						);
					})}
				</ul>,
			);
			key += 1;
			continue;
		}

		if (ordered.test(line)) {
			const items: string[] = [];
			while (index < lines.length && ordered.test(lines[index] ?? "")) {
				items.push(ordered.exec(lines[index] ?? "")?.[1] ?? "");
				index += 1;
			}
			blocks.push(
				<ol key={at} className="list-decimal space-y-1 pl-5">
					{items.map((item, itemIndex) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: the item order is the list's order.
						<li key={`${at}-${itemIndex}`}>{inline(item, `${at}-${itemIndex}`)}</li>
					))}
				</ol>,
			);
			key += 1;
			continue;
		}

		const paragraph: string[] = [];
		while (
			index < lines.length &&
			!isBlank(lines[index] ?? "") &&
			fence.exec(lines[index] ?? "") === null &&
			heading.exec(lines[index] ?? "") === null &&
			!/^\s*([-*_])\1{2,}\s*$/.test(lines[index] ?? "") &&
			!unordered.test(lines[index] ?? "") &&
			!ordered.test(lines[index] ?? "") &&
			!(lines[index] ?? "").trimStart().startsWith(">")
		) {
			paragraph.push(lines[index] ?? "");
			index += 1;
		}
		blocks.push(
			<p key={at} className="leading-relaxed">
				{inline(paragraph.join(" "), at)}
			</p>,
		);
		key += 1;
	}

	if (text.trim().length === 0) {
		return <p className="p-6 text-sm text-fg-muted">This Markdown file is empty.</p>;
	}

	return (
		<div
			className={cn(
				"mx-auto flex max-w-3xl flex-col gap-3 p-6 text-sm text-fg",
				style === "tufte" && "max-w-2xl font-serif",
			)}
			data-markdown-style={style}
			data-base-dir={baseDir}
		>
			{blocks}
		</div>
	);
}
