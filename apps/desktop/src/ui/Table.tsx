/**
 * @feature APP-13 Table
 * Owns: the semantic table used by the resource, environment and shortcuts lists.
 * Behaviour: ui-map.md 8 (Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell,
 * TableCaption); ui-dimensions.md 4 (compact rows: settings-style rows are 28px to 32px tall, text-sm).
 * Our design choice: plain semantic elements, not a headless library, so the browser gives sorting, column
 * headers and caption semantics to assistive technology for free. The wrapper scrolls sideways instead of
 * squeezing columns on a narrow window.
 * Must handle: a caption that names the table; a header, a body and a footer; long cells that do not wrap
 * the header; a row marked selected by the caller.
 * Test first: the caption names the table and the column headers and cells have their roles.
 */
import type { ComponentProps } from "react";
import { cn } from "./cn.ts";

export function Table({ className, children, ...props }: ComponentProps<"table">) {
	return (
		<div className="relative w-full overflow-x-auto">
			<table className={cn("w-full caption-bottom text-sm", className)} {...props}>
				{children}
			</table>
		</div>
	);
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
	return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
	return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
	return (
		<tfoot className={cn("border-t border-border bg-surface font-medium", className)} {...props} />
	);
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
	return (
		<tr
			className={cn(
				"border-b border-border transition-colors hover:bg-hover data-[state=selected]:bg-active",
				className,
			)}
			{...props}
		/>
	);
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
	return (
		<th
			scope="col"
			className={cn(
				"h-8 whitespace-nowrap px-2 text-left align-middle text-xs font-medium text-fg-muted",
				className,
			)}
			{...props}
		/>
	);
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
	return <td className={cn("px-2 py-2 align-middle", className)} {...props} />;
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
	return <caption className={cn("mt-2 text-xs text-fg-muted", className)} {...props} />;
}
