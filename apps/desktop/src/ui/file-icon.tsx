/**
 * @feature APP-05 File icons
 * Owns: the Material Icon Theme's SVG for a file, drawn at the size a caller asks for.
 * Behaviour: ui-map.md 3.6 and 3.2 (the All files tree, the file tab and the file path chip show the
 * file's own icon). Conductor 0.92.1 puts the theme's SVG at /material-icons/<icon>.svg on an image
 * (renderApp @2483068); the SVGs come from the `material-icon-theme` package (MIT).
 * Our design choice (D002): every SVG is imported from that package as an asset, so the app ships the
 * theme's own art and no Conductor asset.
 * Must handle: a file the theme has no name for (its `file` icon), any of the theme's icon names, and
 * a missing label (the image is decorative, so the row's text names it).
 * Test first: "draws the theme's icon as an image for a .rs file".
 */
import { cn } from "./cn.ts";
import { fileIconName } from "./file-icon.ts";

const ICON_URLS = import.meta.glob<string>("../../node_modules/material-icon-theme/icons/*.svg", {
	eager: true,
	query: "?url",
	import: "default",
});

/** The package's icon URLs by icon name, without the folder or `.svg` suffix. */
const ICON_BY_NAME: Readonly<Record<string, string>> = Object.fromEntries(
	Object.entries(ICON_URLS).map(([file, url]) => [
		file.slice(file.lastIndexOf("/") + 1, -".svg".length),
		url,
	]),
);

export interface FileTypeIconProps {
	/** The file's path or name; only its last segment picks the icon. */
	path: string;
	className?: string;
}

/** The Material Icon Theme's icon for a file, as an image Conductor would draw. */
export function FileTypeIcon({ path, className }: FileTypeIconProps) {
	const name = fileIconName(path);
	return (
		<img
			src={ICON_BY_NAME[name] ?? ICON_BY_NAME.file}
			alt=""
			aria-hidden="true"
			draggable={false}
			data-file-icon={name}
			className={cn("shrink-0 object-contain", className)}
		/>
	);
}
