/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the 16px brand mark an MCP server's row and card show, or its initial when there is none.
 * Behaviour: Conductor's `Pwe` (renderApp-DeUrsznk.js @8715231) matches a server by its name, or
 * by its URL's host being a known domain or under one, first against a table of images (`aqo`
 * @8713023), then against a table of glyphs with optional brand colours (`lqo`), and otherwise
 * draws the host's favicon or, failing that, the name's first letter (`uqo`).
 * Our design choice (D131): no art comes from Conductor's bundle. Its `lqo` glyphs are Simple
 * Icons through react-icons; 13 of its 14 match `simple-icons` 14.15.0 path for path, and Vercel's
 * draws the same triangle with another path. They keep Conductor's colours, as tokens. Its `aqo`
 * marks are its own bitmaps, so a brand Simple Icons also has is drawn as that glyph in the text
 * colour; the rest, and Conductor's own drawings (Exa, Firecrawl, Granola, Honeycomb, Neon), show
 * the initial. Favicons are not fetched: Conductor gets them from Google's favicon service, which
 * would tell Google every server a user adds.
 * Test first: starts a new server on OAuth, and saving it opens the provider's sign-in.
 */
import {
	type SimpleIcon,
	siAirtable,
	siAsana,
	siAtlassian,
	siCanva,
	siCloudflare,
	siDatadog,
	siFigma,
	siGithub,
	siGmail,
	siGooglecalendar,
	siIntercom,
	siLinear,
	siNotion,
	siPlanetscale,
	siPosthog,
	siSentry,
	siSlack,
	siSnowflake,
	siStripe,
	siSupabase,
	siVercel,
	siZoom,
} from "simple-icons";
import { cn } from "../../../ui/cn.ts";

interface Mark {
	domain: string;
	name: string;
	icon: SimpleIcon;
	/** Conductor's colour, as a token class; absent draws in the text colour. */
	tint?: string;
}

/** Conductor's image table (`aqo`), where Simple Icons has the brand. Checked first, as Conductor does. */
const IMAGE_BRANDS: readonly Mark[] = [
	{ domain: "mcp.airtable.com", name: "airtable", icon: siAirtable },
	{ domain: "asana.com", name: "asana", icon: siAsana },
	{ domain: "mcp.atlassian.com", name: "atlassian", icon: siAtlassian },
	{ domain: "datadoghq.com", name: "datadog", icon: siDatadog },
	{ domain: "mcp.intercom.com", name: "intercom", icon: siIntercom },
	{ domain: "linear.app", name: "linear", icon: siLinear },
	{ domain: "planetscale.com", name: "planetscale", icon: siPlanetscale },
	{ domain: "slack.com", name: "slack", icon: siSlack },
];

/** Conductor's glyph table (`lqo`), with its colours. */
const GLYPH_BRANDS: readonly Mark[] = [
	{ domain: "mcp.canva.com", name: "canva", icon: siCanva, tint: "text-brand-canva" },
	{
		domain: "cloudflare.com",
		name: "cloudflare",
		icon: siCloudflare,
		tint: "text-brand-cloudflare",
	},
	{ domain: "figma.com", name: "figma", icon: siFigma, tint: "text-brand-figma" },
	{ domain: "gmailmcp.googleapis.com", name: "gmail", icon: siGmail, tint: "text-brand-gmail" },
	{ domain: "github.com", name: "github", icon: siGithub },
	{ domain: "githubcopilot.com", name: "github", icon: siGithub },
	{
		domain: "calendarmcp.googleapis.com",
		name: "google-calendar",
		icon: siGooglecalendar,
		tint: "text-brand-google-calendar",
	},
	{ domain: "notion.com", name: "notion", icon: siNotion },
	{ domain: "posthog.com", name: "posthog", icon: siPosthog },
	{ domain: "sentry.dev", name: "sentry", icon: siSentry },
	{ domain: "sentry.io", name: "sentry", icon: siSentry },
	{
		domain: "snowflakecomputing.com",
		name: "snowflake",
		icon: siSnowflake,
		tint: "text-brand-snowflake",
	},
	{ domain: "stripe.com", name: "stripe", icon: siStripe, tint: "text-brand-stripe" },
	{ domain: "supabase.com", name: "supabase", icon: siSupabase, tint: "text-brand-supabase" },
	{ domain: "vercel.com", name: "vercel", icon: siVercel },
	{ domain: "mcp.zoom.us", name: "zoom", icon: siZoom, tint: "text-brand-zoom" },
];

function hostOf(url: string | undefined): string | undefined {
	if (url === undefined) return undefined;
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

/** The mark Conductor's rule finds for a server: by name, or by a host at or under a domain. */
export function mcpServerMark(name: string, url: string | undefined): Mark | undefined {
	const lower = name.toLowerCase();
	const host = hostOf(url);
	const matches = (mark: Mark) =>
		lower === mark.name || host === mark.domain || host?.endsWith(`.${mark.domain}`) === true;
	return IMAGE_BRANDS.find(matches) ?? GLYPH_BRANDS.find(matches);
}

export function McpServerIcon({
	name,
	url,
	className,
}: {
	name: string;
	url?: string;
	className?: string;
}) {
	const mark = mcpServerMark(name, url);
	if (mark === undefined) {
		return (
			<span
				aria-hidden="true"
				className={cn(
					"flex size-4 shrink-0 items-center justify-center text-xs leading-none font-medium text-fg-muted",
					className,
				)}
			>
				{name.trim().charAt(0).toUpperCase()}
			</span>
		);
	}
	return (
		<svg
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
			focusable="false"
			data-mark={mark.icon.slug}
			className={cn("size-4 shrink-0", mark.tint ?? "text-fg", className)}
		>
			<path d={mark.icon.path} />
		</svg>
	);
}
