// ─── Thinking Filter ───
// Strips `<think>...</think>` reasoning blocks out of a streamed completion.
//
// Reasoning models emit their chain of thought as ordinary generated tokens, so
// it is both shown to the player and charged against `max_new_tokens` — the exact
// budget an NPC's one-to-three-sentence reply is supposed to fit inside. The
// worker turns thinking off at the source (see `enable_thinking` in the chat
// template); this filter is the guarantee that no reasoning text reaches the UI
// or the transcript even when a template emits it anyway.
//
// It has to work on a token stream, so tags may be split across chunk
// boundaries: "…<thi" followed by "nk>…".

const OPEN_TAG = /<\s*think\s*>/i;
const CLOSE_TAG = /<\s*\/\s*think\s*>/i;

/** The literal spellings a model actually emits. */
const CANONICAL_TAGS = ['<think>', '</think>'];

/**
 * A suffix that could still grow into a think tag, e.g. `<thi` or `<`.
 *
 * Deliberately conservative: it holds back anything that looks like the start of
 * a tag, even if the tag never completes. Holding a few characters is harmless;
 * emitting half a tag to the player is not.
 */
function looksLikeTagStart(tail: string): boolean {
  return /^<\s*\/?\s*[a-z]*$/i.test(tail);
}

/** A proper prefix of a canonical tag, used to discard a dangling tail at flush. */
function isCanonicalTagPrefix(tail: string): boolean {
  const normalized = tail.toLowerCase();
  return CANONICAL_TAGS.some(
    (tag) => normalized.length < tag.length && tag.startsWith(normalized),
  );
}

/** Length of the suffix of `text` that could still grow into a complete think tag. */
function partialTagLength(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] !== '<') continue;
    // An earlier '<' can only begin a tag if no later '<' exists, because a tag
    // contains no '<' of its own.
    return looksLikeTagStart(text.slice(i)) ? text.length - i : 0;
  }
  return 0;
}

export class ThinkingFilter {
  private buffer = '';
  private suppressing = false;

  /** Feed a streamed chunk, returning only the text that should be visible. */
  public push(chunk: string): string {
    if (!chunk) return '';
    this.buffer += chunk;
    let out = '';

    for (;;) {
      if (this.suppressing) {
        const close = CLOSE_TAG.exec(this.buffer);
        if (!close) {
          // Reasoning is discarded, but a closing tag may be mid-arrival across
          // this chunk boundary, so keep just enough to recognise it.
          const hold = partialTagLength(this.buffer);
          this.buffer = this.buffer.slice(this.buffer.length - hold);
          return out;
        }
        this.buffer = this.buffer.slice(close.index + close[0].length);
        this.suppressing = false;
        continue;
      }

      const open = OPEN_TAG.exec(this.buffer);
      const strayClose = CLOSE_TAG.exec(this.buffer);

      let hit: RegExpExecArray | null = null;
      let isOpener = false;
      if (open && strayClose) {
        if (open.index <= strayClose.index) {
          hit = open;
          isOpener = true;
        } else {
          hit = strayClose;
        }
      } else if (open) {
        hit = open;
        isOpener = true;
      } else {
        hit = strayClose;
      }

      if (hit) {
        out += this.buffer.slice(0, hit.index);
        const consumed = hit.index + hit[0].length;
        this.buffer = this.buffer.slice(consumed);
        // A closing tag with no opener is stray markup; drop it either way.
        this.suppressing = isOpener;
        continue;
      }

      const hold = partialTagLength(this.buffer);
      out += this.buffer.slice(0, this.buffer.length - hold);
      this.buffer = this.buffer.slice(this.buffer.length - hold);
      return out;
    }
  }

  /**
   * Emit anything still buffered at the end of a stream. Reasoning is never
   * emitted, and a dangling partial tag is dropped rather than shown.
   */
  public flush(): string {
    const remaining = this.buffer;
    this.buffer = '';
    if (this.suppressing) return '';
    // A dangling half-tag at the end of a stream is dropped rather than shown.
    return isCanonicalTagPrefix(remaining) ? '' : remaining;
  }

  /** True while the stream is inside an unterminated reasoning block. */
  public get isSuppressing(): boolean {
    return this.suppressing;
  }
}