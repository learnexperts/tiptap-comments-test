import type { ResolvedPos } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";

/** Which way the caret travels. Never zero — see `nearestCursorPosition`. */
type Direction = 1 | -1;

/**
 * The nearest position a caret can occupy, searching in `dir`; `$pos` itself if
 * it already is one, `null` at the document edge.
 *
 * `dir` must not be zero: `findSelectionIn` advances its scan by `dir`, so zero
 * spins forever — a hang, not an exception, that test timeouts cannot interrupt.
 */
function nearestCursorPosition($pos: ResolvedPos, dir: Direction) {
  return Selection.findFrom($pos, dir, true)?.$head ?? null;
}

/**
 * Movements available before the caret leaves its textblock. Arithmetic rather
 * than a search, because textblock positions are contiguous cursor stops.
 *
 * Expects `$pos.parent.inlineContent`.
 */
function movesToBlockEdge($pos: ResolvedPos, dir: Direction) {
  const edge = dir > 0 ? $pos.end() : $pos.start();

  return Math.abs(edge - $pos.pos);
}

/** Where one movement out of the current textblock lands. */
function adjacentBlockCursorPosition($pos: ResolvedPos, dir: Direction) {
  const beyond = dir > 0 ? $pos.after() : $pos.before();

  return nearestCursorPosition($pos.doc.resolve(beyond), dir);
}

/**
 * Moves `position` by `offset` **cursor movements** — what `offset` presses of
 * the arrow key would do, and what shift+arrow expands a selection by. Every
 * landing spot a caret can occupy costs one, so a `hardBreak`, an inline atom
 * and a block boundary each cost one.
 *
 * Contrast `offsetTextPosition`, which counts characters and crosses an atom
 * for free, and raw position arithmetic, which charges two for a block
 * boundary. Clamps at either end of the document.
 *
 * Block-level atoms are skipped rather than given the node selection a real
 * caret would stop on. No caller needs that yet.
 */
export function offsetCursorPosition(position: ResolvedPos, offset: number) {
  const dir: Direction = offset < 0 ? -1 : 1;
  let remaining = Math.abs(offset);

  // Snapping onto a cursor stop costs no movement.
  let $pos = nearestCursorPosition(position, dir) ?? position;

  while (remaining > 0 && $pos.parent.inlineContent) {
    const withinBlock = Math.min(remaining, movesToBlockEdge($pos, dir));

    if (withinBlock > 0) {
      $pos = $pos.doc.resolve($pos.pos + dir * withinBlock);
      remaining -= withinBlock;
    }

    if (remaining === 0) {
      break;
    }

    const $adjacent = adjacentBlockCursorPosition($pos, dir);

    if (!$adjacent) {
      break; // Document edge — clamp here.
    }

    $pos = $adjacent;
    remaining -= 1;
  }

  return $pos;
}

/**
 * Moves `position` by `offset` **characters**, stepping over non-text leaf
 * nodes and node boundaries without counting them. See `offsetCursorPosition`
 * for caret-equivalent movement.
 */
export function offsetTextPosition(position: ResolvedPos, offset: number) {
  const { doc } = position;
  const dir = Math.sign(offset);
  let remaining = Math.abs(offset);
  let pos = position.pos;

  while (remaining > 0) {
    const neighbor =
      dir > 0 ? doc.resolve(pos).nodeAfter : doc.resolve(pos).nodeBefore;

    if (neighbor?.isText) {
      const step = Math.min(remaining, neighbor.nodeSize);
      pos += dir * step;
      remaining -= step;
      continue;
    }

    const next = pos + dir * (neighbor?.isLeaf ? neighbor.nodeSize : 1);
    if (next < 0 || next > doc.content.size) {
      break;
    }
    pos = next;
  }

  return doc.resolve(pos);
}
