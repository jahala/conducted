/**
 * @feature SIDE-02 JSON-RPC over a Unix socket: the line splitter every stream reader shares
 * Owns: `LineSplitter`, which collects text chunks from a stream and hands back the complete
 * lines they hold, without their newline.
 * Behaviour: research/conductor/sessions.md section 10 "Framing" (each message is one line,
 * split on "\n").
 * Must handle: a line split over many chunks, several lines in one chunk, a chunk that ends on its
 * newline, and a caller that drops an unfinished line it finds too long. Each character is looked
 * at once: only the new chunk is searched, and a line's earlier pieces wait in a list that is
 * joined once, when its newline comes. Searching the joined text again on every chunk made a long
 * line cost time in proportion to its length squared (#617).
 * Test first: a long line in many chunks costs time in proportion to its length.
 */

/** One per stream: the unfinished line belongs to the stream it came from. */
export class LineSplitter {
	#pieces: string[] = [];
	#pendingChars = 0;

	/** The lines `chunk` completes, in order, each without its "\n". */
	push(chunk: string): string[] {
		const lines: string[] = [];
		let start = 0;
		for (let end = chunk.indexOf("\n"); end !== -1; end = chunk.indexOf("\n", start)) {
			const piece = chunk.slice(start, end);
			if (this.#pieces.length === 0) {
				lines.push(piece);
			} else {
				this.#pieces.push(piece);
				lines.push(this.#pieces.join(""));
				this.#pieces = [];
				this.#pendingChars = 0;
			}
			start = end + 1;
		}
		if (start < chunk.length) {
			this.#pieces.push(start === 0 ? chunk : chunk.slice(start));
			this.#pendingChars += chunk.length - start;
		}
		return lines;
	}

	/** How many characters of an unfinished line are held. */
	get pendingChars(): number {
		return this.#pendingChars;
	}

	/** Drops the unfinished line held so far. */
	discard(): void {
		this.#pieces = [];
		this.#pendingChars = 0;
	}
}
