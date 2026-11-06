/**
 * @feature CHAT-06 Assistant text
 * Owns: Rendering the assistant's Markdown: headings, lists, tables, links, code blocks, callouts
 * and images.
 * Behaviour: ui-map.md 3.3 (Assistant text: Markdown, Mermaid diagrams, callouts
 * Note/Tip/Important/Warning/Caution, code blocks with copy, images, video).
 * Our design choice: A small Markdown parser of our own handles the subset Conductor shows, instead
 * of adding a Markdown library. Code blocks use shiki through CodeBlock. Mermaid and video are later
 * additions.
 * Must handle: Partial Markdown while streaming (an open code fence or list must not flash); very
 * long lines wrap; links open outside the app through the opener, never inside the window; raw HTML
 * is not rendered; an image that fails to load shows its alt text; an image from a web address is never loaded
 * (a reply could carry data out in the address), it shows as a link instead; text is selectable.
 * Test first: A text with an unclosed code fence renders as a code block without throwing; the
 * "not_absolutely_right" setting controls whether a leading absolutely-right phrase is removed.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type ReactNode, useState } from "react";
import { useSetting } from "../../core/hooks.ts";
import { cn } from "../../ui/cn.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { ExternalLink } from "./ExternalLink.tsx";

type Block =
	| { kind: "code"; language: string | null; code: string }
	| { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
	| { kind: "list"; ordered: boolean; items: string[] }
	| { kind: "table"; header: string[]; rows: string[][] }
	| { kind: "callout"; label: string; text: string }
	| { kind: "quote"; text: string }
	| { kind: "hr" }
	| { kind: "paragraph"; text: string };

const FENCE = /^```\s*(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const CALLOUT = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;
const QUOTE = /^>\s?/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

const LEADING_FILLER =
	/^\s*(?:you(?:'re| are)\s+)?absolutely\s+right(?:\s+again)?\s*[.!]?[\s,;:—-]*/i;

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

/** Stable key for content that can repeat: the item's position inside its block. */
function positionKey(prefix: string, index: number): string {
	return `${prefix}#${index}`;
}

/** Conductor hides a habitual opening phrase so the reply starts with its substance. */
export function stripLeadingFiller(text: string): string {
	return text.replace(LEADING_FILLER, "");
}

function looksLikeTable(lines: string[], index: number): boolean {
	const line = lines[index];
	const next = lines[index + 1];
	return (
		line !== undefined && next !== undefined && line.includes("|") && TABLE_SEPARATOR.test(next)
	);
}

function isBlockStart(lines: string[], index: number): boolean {
	const line = lines[index];
	if (line === undefined || line.trim().length === 0) return true;
	return (
		FENCE.test(line.trim()) ||
		HEADING.test(line) ||
		CALLOUT.test(line) ||
		QUOTE.test(line) ||
		UNORDERED.test(line) ||
		ORDERED.test(line) ||
		RULE.test(line.trim()) ||
		looksLikeTable(lines, index)
	);
}

function splitCells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

export function parseMarkdown(source: string): Block[] {
	const lines = source.split(/\r?\n/);
	const blocks: Block[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";
		const trimmed = line.trim();

		if (trimmed.length === 0) {
			index += 1;
			continue;
		}

		const fence = FENCE.exec(trimmed);
		if (fence !== null) {
			const language = fence[1] === undefined || fence[1].length === 0 ? null : fence[1];
			const code: string[] = [];
			index += 1;
			while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
				code.push(lines[index] ?? "");
				index += 1;
			}
			if (index < lines.length) index += 1;
			blocks.push({ kind: "code", language, code: code.join("\n") });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading !== null) {
			const level = (heading[1] ?? "#").length as 1 | 2 | 3 | 4 | 5 | 6;
			blocks.push({ kind: "heading", level, text: heading[2] ?? "" });
			index += 1;
			continue;
		}

		const callout = CALLOUT.exec(line);
		if (callout !== null) {
			const label = (callout[1] ?? "Note").toLowerCase();
			const text = [callout[2] ?? ""];
			index += 1;
			while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
				text.push((lines[index] ?? "").replace(QUOTE, ""));
				index += 1;
			}
			blocks.push({
				kind: "callout",
				label: label.charAt(0).toUpperCase() + label.slice(1),
				text: text.join("\n").trim(),
			});
			continue;
		}

		if (QUOTE.test(line)) {
			const text: string[] = [];
			while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
				text.push((lines[index] ?? "").replace(QUOTE, ""));
				index += 1;
			}
			blocks.push({ kind: "quote", text: text.join("\n").trim() });
			continue;
		}

		if (RULE.test(trimmed)) {
			blocks.push({ kind: "hr" });
			index += 1;
			continue;
		}

		if (looksLikeTable(lines, index)) {
			const header = splitCells(line);
			index += 2;
			const rows: string[][] = [];
			while (index < lines.length && (lines[index] ?? "").includes("|")) {
				const row = lines[index] ?? "";
				if (row.trim().length === 0) break;
				rows.push(splitCells(row));
				index += 1;
			}
			blocks.push({ kind: "table", header, rows });
			continue;
		}

		const unordered = UNORDERED.exec(line);
		if (unordered !== null) {
			const items: string[] = [];
			while (index < lines.length) {
				const match = UNORDERED.exec(lines[index] ?? "");
				if (match === null) break;
				items.push(match[1] ?? "");
				index += 1;
			}
			blocks.push({ kind: "list", ordered: false, items });
			continue;
		}

		const ordered = ORDERED.exec(line);
		if (ordered !== null) {
			const items: string[] = [];
			while (index < lines.length) {
				const match = ORDERED.exec(lines[index] ?? "");
				if (match === null) break;
				items.push(match[1] ?? "");
				index += 1;
			}
			blocks.push({ kind: "list", ordered: true, items });
			continue;
		}

		const paragraph: string[] = [];
		while (index < lines.length && !isBlockStart(lines, index)) {
			paragraph.push((lines[index] ?? "").trim());
			index += 1;
		}
		if (paragraph.length === 0) {
			index += 1;
			continue;
		}
		blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
	}

	return blocks;
}

const INLINE =
	/(!\[[^\]]*\]\([^)]+\))|(\[[^\]]+\]\([^)]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;

/** A web address or another scheme. An address like this in a reply could carry data out of the app. */
const REMOTE_IMAGE = /^(?:\/\/|[a-z][a-z0-9+.-]*:)/i;
const INLINE_IMAGE = /^data:image\//i;

function MarkdownImage({ src, alt }: { src: string; alt: string }) {
	const [failed, setFailed] = useState(false);
	const label = alt.length > 0 ? alt : src;
	if (REMOTE_IMAGE.test(src) && !INLINE_IMAGE.test(src)) {
		return (
			<ExternalLink url={src} className="text-link underline-offset-2 hover:underline">
				{label}
			</ExternalLink>
		);
	}
	if (failed) {
		return <span className="text-fg-muted">{label}</span>;
	}
	return (
		<img
			src={src}
			alt={alt}
			onError={() => setFailed(true)}
			className="my-2 max-h-96 max-w-full rounded-md border border-border object-contain"
		/>
	);
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let last = 0;
	let index = 0;
	for (const match of text.matchAll(INLINE)) {
		const at = match.index ?? 0;
		if (at > last) nodes.push(text.slice(last, at));
		const token = match[0];
		const key = `${keyPrefix}-${index}`;
		if (token.startsWith("![")) {
			const inner = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(token);
			nodes.push(<MarkdownImage key={key} alt={inner?.[1] ?? ""} src={inner?.[2] ?? ""} />);
		} else if (token.startsWith("[")) {
			const inner = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
			const url = inner?.[2] ?? "";
			nodes.push(
				<ExternalLink key={key} url={url} className="text-link underline-offset-2 hover:underline">
					{inner?.[1] ?? token}
				</ExternalLink>,
			);
		} else if (token.startsWith("`")) {
			nodes.push(
				<code key={key} className="rounded-xs bg-muted px-1 py-0.5 font-mono text-code">
					{token.slice(1, -1)}
				</code>,
			);
		} else if (token.startsWith("**") || token.startsWith("__")) {
			nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
		} else {
			nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
		}
		last = at + token.length;
		index += 1;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}

export interface AssistantTextProps {
	text: string;
	/** The workspace a shell code block's command runs in. */
	workspaceId?: WorkspaceId;
	/** The workspace is ready and not archived. */
	canRun?: boolean;
}

export function AssistantText({ text, workspaceId, canRun }: AssistantTextProps) {
	const style = useSetting<string>("markdown_style");
	const stripFiller = useSetting<boolean>("not_absolutely_right");
	const cleaned = stripFiller ? stripLeadingFiller(text) : text;
	if (cleaned.trim().length === 0) return null;
	const blocks = parseMarkdown(cleaned);
	const tufte = style === "tufte";

	return (
		<div
			data-markdown-style={tufte ? "tufte" : "default"}
			className={cn(
				"flex select-text flex-col gap-2 text-sm leading-relaxed text-fg",
				tufte && "max-w-[65ch] leading-loose",
			)}
		>
			{blocks.map((block, blockIndex) => {
				const key = `block-${blockIndex}`;
				switch (block.kind) {
					case "code":
						return (
							<CodeBlock
								key={key}
								code={block.code}
								language={block.language}
								workspaceId={workspaceId}
								canRun={canRun}
							/>
						);
					case "heading": {
						const Tag = HEADING_TAGS[block.level];
						return (
							<Tag
								key={key}
								className={cn(
									"font-medium text-fg",
									block.level === 1 && "text-xl",
									block.level === 2 && "text-lg",
									block.level >= 3 && "text-base",
								)}
							>
								{renderInline(block.text, key)}
							</Tag>
						);
					}
					case "list": {
						const Tag = block.ordered ? "ol" : "ul";
						return (
							<Tag
								key={key}
								className={cn(
									"ml-5 flex flex-col gap-1",
									block.ordered ? "list-decimal" : "list-disc",
								)}
							>
								{block.items.map((item, itemIndex) => (
									<li key={positionKey(`${key}-item`, itemIndex)}>
										{renderInline(item, `${key}-${itemIndex}`)}
									</li>
								))}
							</Tag>
						);
					}
					case "table":
						return (
							<div key={key} className="overflow-x-auto">
								<table className="w-full border-collapse text-sm">
									<thead>
										<tr>
											{block.header.map((cell, cellIndex) => (
												<th
													key={positionKey(`${key}-h`, cellIndex)}
													className="border-b border-border-strong px-2 py-1 text-left font-medium text-fg"
												>
													{renderInline(cell, `${key}-h-${cellIndex}`)}
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{block.rows.map((row, rowIndex) => (
											<tr key={positionKey(`${key}-r`, rowIndex)}>
												{row.map((cell, cellIndex) => (
													<td
														key={positionKey(`${key}-r-${rowIndex}`, cellIndex)}
														className="border-b border-border px-2 py-1 text-fg-muted"
													>
														{renderInline(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>
						);
					case "callout":
						return (
							<div key={key} className="rounded-md border border-border bg-surface px-3 py-2">
								<p className="text-xs font-medium text-fg">{block.label}</p>
								<p className="text-sm text-fg-muted">{renderInline(block.text, key)}</p>
							</div>
						);
					case "quote":
						return (
							<blockquote key={key} className="border-l-2 border-border-strong pl-3 text-fg-muted">
								{renderInline(block.text, key)}
							</blockquote>
						);
					case "hr":
						return <hr key={key} className="border-border" />;
					case "paragraph":
						return (
							<p key={key} className="whitespace-pre-wrap break-words">
								{renderInline(block.text, key)}
							</p>
						);
					default:
						return null;
				}
			})}
		</div>
	);
}
