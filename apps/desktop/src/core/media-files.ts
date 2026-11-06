/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Owns: the one rule for which file paths are images and which are videos, by extension, and the
 * file a reply's Markdown target names. The chat's attachments, a reply's images and videos, the
 * image view card, the file preview, the attachment actions and the Feedback dialog all read it.
 * Behaviour: ui-map.md 3.3 (images and videos in the chat open the attachment viewer).
 * Our design choice: the image kinds are the ones macOS can turn into PNG (`sips`) and the webview
 * can show. A caller that takes fewer kinds passes its own list, as the Feedback dialog does.
 * Must handle: an extension in any case; a query string or fragment after a Markdown target; a
 * name with no extension, or a dot file such as ".png" (neither is an image); a target relative to
 * the workspace, with "." and ".." parts (resolved against the workspace folder).
 * Test first: "shot.PNG" is an image, "clip.mov?t=2" is a video, and a narrower list refuses "a.svg".
 */

export const IMAGE_EXTENSIONS: readonly string[] = [
	"png",
	"jpg",
	"jpeg",
	"gif",
	"webp",
	"avif",
	"svg",
	"bmp",
	"tif",
	"tiff",
	"heic",
];

export const VIDEO_EXTENSIONS: readonly string[] = [
	"mp4",
	"m4v",
	"mov",
	"webm",
	"ogv",
	"avi",
	"mkv",
];

/** The bare target, without a query string or fragment. */
export const bareTarget = (src: string): string => src.split(/[?#]/)[0] ?? "";

function normalizePath(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part.length === 0 || part === ".") continue;
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `/${parts.join("/")}`;
}

/**
 * The absolute file a Markdown target names: an absolute target as it is, a relative one inside
 * `root` (the workspace folder). Null for an empty target.
 */
export function targetPath(root: string, src: string): string | null {
	const target = bareTarget(src);
	if (target.length === 0) return null;
	return normalizePath(target.startsWith("/") ? target : `${root}/${target}`);
}

/** The lower-case extension of a path or Markdown target, without a query string or fragment. */
export function extensionOf(path: string): string {
	const target = bareTarget(path);
	const name = target.slice(target.lastIndexOf("/") + 1);
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) return "";
	return name.slice(dot + 1).toLowerCase();
}

export function isImagePath(
	path: string,
	extensions: readonly string[] = IMAGE_EXTENSIONS,
): boolean {
	return extensions.includes(extensionOf(path));
}

export function isVideoPath(path: string): boolean {
	return VIDEO_EXTENSIONS.includes(extensionOf(path));
}
