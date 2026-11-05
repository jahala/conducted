/**
 * @feature APP-13 Card
 * Owns: the bordered surface that groups related content, such as a settings section or an agent card.
 * Behaviour: ui-map.md 8 (Card and its Content, Description, Footer, Header and Title parts);
 * ui-dimensions.md 8 (a card sits on the raised surface with a 1px border and 8px radius).
 * Our design choice: the parts are plain elements with data-slot names, so a screen can style one part
 * without rebuilding the card. The title is a heading, so screen readers can jump between cards.
 * Must handle: a card with only some parts; long descriptions that wrap; content that fills the width.
 * Test first: the title, description, content and footer all render inside one bordered raised surface.
 */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			data-slot="card"
			className={cn("flex flex-col rounded-lg border border-border bg-raised text-fg", className)}
		>
			{children}
		</div>
	);
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div data-slot="card-header" className={cn("flex flex-col gap-1 p-4", className)}>
			{children}
		</div>
	);
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<h3 data-slot="card-title" className={cn("text-sm font-medium text-fg", className)}>
			{children}
		</h3>
	);
}

export function CardDescription({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<p data-slot="card-description" className={cn("text-sm text-fg-muted", className)}>
			{children}
		</p>
	);
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div data-slot="card-content" className={cn("p-4 pt-0", className)}>
			{children}
		</div>
	);
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div data-slot="card-footer" className={cn("flex items-center gap-2 p-4 pt-0", className)}>
			{children}
		</div>
	);
}
