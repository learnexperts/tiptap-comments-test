import { Extension } from "@tiptap/core";
import { Mark, type MarkType } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

const MARK_CREATE_PATCHED = Symbol("collabWritebackMarkCreate");
const APPLY_DELTA_PATCHED = Symbol("collabWritebackApplyDelta");
const pluginKey = new PluginKey("collabWriteback");

export type YTextDeltaOp = {
  insert?: string | object;
  retain?: number;
  delete?: number;
  attributes?: Record<string, unknown>;
};

type TextProto = typeof Y.Text.prototype & {
  [APPLY_DELTA_PATCHED]?: boolean;
};

type DocWithTransaction = Y.Doc & {
  _transaction: { origin: unknown } | null;
};

/**
 * Keep only the attr keys that were supplied to `MarkType.create`, in sorted
 * order. `computeAttrs` densifies the full textStyle kit onto every mark
 * (`fontSize: undefined`, …); restricting to the input key set restores the
 * FontFamily-only shape y-prosemirror / comment-only sync tolerate:
 * `{ fontFamily: "Arial" }` instead of a four-key bag.
 *
 * y-prosemirror writes `mark.attrs` wholesale and hashes `mark.toJSON()` for
 * overlapping marks — densified keys show up via `encodeAny` even when
 * `JSON.stringify` hides `undefined`.
 */
export function canonicalizeTextStyleAttrs(
  attrs: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attrs)
      .filter(([key]) => keys.includes(key))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

/** Keys with values y-prosemirror should persist on the PM→Y path. */
export function textStyleWritebackKeys(
  attrs: Record<string, unknown>
): string[] {
  return Object.keys(attrs).filter(
    (key) => attrs[key] != null && attrs[key] !== ""
  );
}

/** Sparse attrs for marks already on the document (pre-writeback). */
export function canonicalTextStyleAttrsForWriteback(
  attrs: Record<string, unknown>
): Record<string, unknown> {
  return canonicalizeTextStyleAttrs(attrs, textStyleWritebackKeys(attrs));
}

export function patchTextStyleMarkCreate(markType: MarkType): void {
  const patched = markType as MarkType & { [MARK_CREATE_PATCHED]?: boolean };
  if (patched[MARK_CREATE_PATCHED]) {
    return;
  }

  const originalCreate = markType.create.bind(markType);

  markType.create = (attrs = null) => {
    const keys = Object.keys(attrs ?? {});
    const mark = originalCreate(attrs);
    return new Mark(
      markType,
      canonicalizeTextStyleAttrs(mark.attrs as Record<string, unknown>, keys)
    );
  };

  patched[MARK_CREATE_PATCHED] = true;
}

/**
 * Local wrap of y-prosemirror `updateYText`.
 *
 * `updateYText` is not exported. After a string diff it `applyDelta`s a retain
 * covering the whole node with **every** mark, including unchanged `textStyle`.
 * Yjs `formatText` then deletes existing `ContentFormat` items for those keys
 * even when values are equal — enough for comment-only collab to treat
 * `textStyle` as touched and revert the whole update (comment included).
 *
 * During `ySyncPluginKey` transactions, drop retain attributes that already
 * match `toDelta()` so writeback still applies new marks (e.g. `inlineThread`)
 * without rewriting format items that did not change.
 */
export function patchYTextApplyDelta(): void {
  const proto = Y.Text.prototype as TextProto;
  if (proto[APPLY_DELTA_PATCHED]) {
    return;
  }

  const original = proto.applyDelta;

  proto.applyDelta = function applyDelta(
    this: Y.Text,
    delta: YTextDeltaOp[],
    options?: { sanitize?: boolean }
  ) {
    const origin = transactionOrigin(this.doc);
    const nextDelta =
      origin === ySyncPluginKey && Array.isArray(delta)
        ? stripUnchangedRetainAttributes(this, delta)
        : delta;
    return original.call(this, nextDelta, options);
  };

  proto[APPLY_DELTA_PATCHED] = true;
}

export function stripUnchangedRetainAttributes(
  ytext: Y.Text,
  delta: YTextDeltaOp[]
): YTextDeltaOp[] {
  if (!isRetainOnlyDelta(delta)) {
    return delta;
  }

  const segments = ytext.toDelta() as YTextDeltaOp[];
  const out: YTextDeltaOp[] = [];
  let index = 0;

  for (const op of delta) {
    const retain = op.retain ?? 0;
    const incoming = op.attributes;
    if (!incoming || Object.keys(incoming).length === 0) {
      pushRetain(out, retain);
      index += retain;
      continue;
    }

    let remaining = retain;
    while (remaining > 0) {
      const { attributes, length } = peekYSegment(segments, index);
      const chunk = Math.min(remaining, length);
      const nextAttrs: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(incoming)) {
        if (attributeNeedsApply(attributes, key, value)) {
          nextAttrs[key] = value;
        }
      }

      pushRetain(
        out,
        chunk,
        Object.keys(nextAttrs).length > 0 ? nextAttrs : undefined
      );
      index += chunk;
      remaining -= chunk;
    }
  }

  return out;
}

/**
 * Comment-safe PM→Y writeback for the full textStyle kit.
 *
 * 1. Patch `textStyle` `MarkType.create` so Collaboration bind and later
 *    edits stay sparse (`{ fontFamily: "Arial" }`, not a four-key bag).
 * 2. `appendTransaction` sparsifies densified marks on the PM doc before
 *    y-prosemirror `view.update` writes them back to Yjs.
 * 3. Patch `Y.Text.applyDelta` so y-sync retains do not rewrite format items
 *    whose values already match.
 *
 * Register after FontFamily / FontSize / Color / BackgroundColor (and after
 * `SparseTextStyleDefaults` if used).
 *
 * Note: if Y already stores densified null keys, those keys are part of the
 * create input and are preserved — this does not migrate historical Y.
 */
export const CollabWriteback = Extension.create({
  name: "collabWriteback",

  /** Run before Collaboration / CommentsKit bind Y → PM. */
  priority: 10_000,

  onBeforeCreate() {
    patchYTextApplyDelta();

    const textStyle = this.editor.schema.marks.textStyle;
    if (!textStyle) {
      return;
    }

    patchTextStyleMarkCreate(textStyle);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        appendTransaction: (_transactions, _oldState, newState) => {
          const textStyle = newState.schema.marks.textStyle;
          if (!textStyle) {
            return null;
          }

          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (!node.isText) {
              return;
            }

            const mark = node.marks.find((entry) => entry.type === textStyle);
            if (!mark) {
              return;
            }

            const attrs = mark.attrs as Record<string, unknown>;
            const canonical = canonicalTextStyleAttrsForWriteback(attrs);
            const from = pos;
            const to = pos + node.nodeSize;

            if (Object.keys(canonical).length === 0) {
              tr.removeMark(from, to, textStyle);
              modified = true;
              return;
            }

            if (textStyleAttrsEqual(attrs, canonical)) {
              return;
            }

            tr.removeMark(from, to, textStyle);
            tr.addMark(from, to, textStyle.create(canonical));
            modified = true;
          });

          if (!modified) {
            return null;
          }

          return tr;
        },
      }),
    ];
  },
});

function textStyleAttrsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && left[key] === right[key]
  );
}

function transactionOrigin(ydoc: Y.Doc | null): unknown {
  if (!ydoc) {
    return undefined;
  }

  return (ydoc as DocWithTransaction)._transaction?.origin;
}

function isRetainOnlyDelta(delta: YTextDeltaOp[]): boolean {
  return delta.every(
    (op) =>
      op.retain != null && op.insert === undefined && op.delete === undefined
  );
}

function peekYSegment(
  segments: YTextDeltaOp[],
  index: number
): { attributes: Record<string, unknown>; length: number } {
  let offset = 0;

  for (const segment of segments) {
    const insert = segment.insert;
    const size = typeof insert === "string" ? insert.length : insert == null ? 0 : 1;
    if (index < offset + size) {
      return {
        attributes: segment.attributes ?? {},
        length: offset + size - index,
      };
    }
    offset += size;
  }

  return { attributes: {}, length: Number.MAX_SAFE_INTEGER };
}

function attributeNeedsApply(
  current: Record<string, unknown>,
  key: string,
  value: unknown
): boolean {
  if (value == null) {
    return current[key] != null;
  }

  return !yjsEqualAttrs(current[key], value);
}

/** Match Yjs `equalAttrs` / lib0 `equalFlat` for one-level mark attr bags. */
function yjsEqualAttrs(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => {
    const value = left[key];
    if (
      value === undefined &&
      !Object.prototype.hasOwnProperty.call(right, key)
    ) {
      return false;
    }

    return right[key] === value;
  });
}

function pushRetain(
  out: YTextDeltaOp[],
  length: number,
  attributes?: Record<string, unknown>
): void {
  if (length <= 0) {
    return;
  }

  const last = out[out.length - 1];
  if (
    last &&
    last.retain != null &&
    last.insert === undefined &&
    last.delete === undefined &&
    retainAttrsEqual(last.attributes, attributes)
  ) {
    last.retain += length;
    return;
  }

  if (attributes) {
    out.push({ retain: length, attributes });
    return;
  }

  out.push({ retain: length });
}

function retainAttrsEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return yjsEqualAttrs(left, right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
