# Issue 4: Comment-only inline thread undone where style ranges overlap

[← back to the README](../README.md)

An inline comment by a comment-only user is undone on text where an author applied two styles whose ranges overlap, for example a color and then a font size over part of the colored text. The comment appears locally, then the server undoes the whole update on sync. Every mark value the comment writes is unchanged. What the update changes is how Yjs stores the style.

```sh
pnpm test:overlap                                        # needs Docker
pnpm exec vitest run tests/overlap/dead-marker.test.ts   # offline, under a second
```

The server logs:

```
Undoing change to document <doc> from guest:<sub> because non-allowed type was touched. Touched types: default. Touched attributes: textStyle={"fontFamily":null,"fontSize":null,"color":"#206487","backgroundColor":"#C6E7FF"}
```

## How Yjs stores a style

Yjs does not store a style on each character. It stores **markers** in the text, each saying "from here, `textStyle` is X". A marker applies until the next marker for the same key.

## Overlapping styles leave a dead marker

An author colors `[one][two]`, then sets the font size on `[two][three]`. For the second step, y-prosemirror writes the full style of each part of the paragraph, one after the other:

```
[one]     {color}
[two]     {color, fontSize}
[three]   {fontSize}
```

Yjs formats each part on its own and does not look at the next one. At the start of a part it writes a marker with the new style. At the end of the part it writes a marker that puts back the style that applied before, so the text after the part keeps it. For `[two]` that is `{color}`. The next part, `[three]`, then starts with `{fontSize}` at the same offset:

```
@9   {color}
@14  {color, fontSize}
@19  {color}       ← end of [two]: puts back the style before it
@19  {fontSize}    ← start of [three]
@26  null
```

The `{color}` marker at 19 applies to no character, because the `{fontSize}` marker after it replaces it at once. We call it a **dead marker**. Yjs does not remove it, and nothing looks wrong. Setting the second style over the *start* of the first leaves a dead `null` marker the same way.

A dead marker appears only where one part ends and the next starts with a different style that is not `null`. A single style, or one style range inside another, leaves none.

## A comment deletes the dead marker

Adding a comment makes y-prosemirror re-write every mark on the paragraph, as in [issue 1](comment-anchor-lost.md). When Yjs reaches the dead marker, the marker disagrees with the value being written, so Yjs deletes it, and writes the marker after it again. The text keeps every style it had. But the update deletes and adds `textStyle` markers, the comment-only check counts that as a style edit, and it undoes the update with the comment's anchor.

[`tests/overlap/dead-marker.test.ts`](../tests/overlap/dead-marker.test.ts) shows this offline. Each case annotates the markers before and after the comment.

## Measured

[`tests/overlap/overlapping-styles.test.ts`](../tests/overlap/overlapping-styles.test.ts) seeds a plain paragraph through the REST API, styles it as a full-rights user through an editor, then comments on it as a comment-only user.

| Author's styles | Across every style | Inside one style |
|---|---|---|
| color, then font size over its end | **undone** | **undone** |
| color, then font size over its start | **undone** | **undone** |
| color, then background over its end | **undone** | **undone** |
| color, then background over its start | **undone** | **undone** |
| color alone | kept | kept |
| color, then font size inside it | kept | kept |

**8 of 12 red.** A selection that does not cross the dead marker is undone too, because the comment re-writes the marks of the whole paragraph. Not every selection is: while diagnosing, we tried eight selections on one paragraph styled color-then-font-size, and the two kept both ended exactly where the styling ends.

We first saw this in lex-frontend, where a capture of the guest's write showed the deleted marker and the server's undo. The test reproduces that paragraph's shape.

## Not covered by our workaround

`workaround/` compares mark values, and keeps a stored value where the written one says the same. Here every value says the same; the deletion happens inside Yjs while it formats. Run with `CollabWriteback` on the guest, or on both author and guest, the result is the same 8 of 12. Yjs's own `cleanupYTextFormatting` does not remove the dead marker either, so it cannot be cleared on the author's side.

Our existing tests did not see it because the REST API stores styles without dead markers, and the comment matrix seeds every style that way.

## Where we think the fix belongs

Either end would close it:

1. **The comment-only check judges markers, not values.** Comparing the style each character has before and after the update would see no change.
2. **Yjs leaves the dead marker, then deletes it on a later write.** Not writing a marker that is replaced at once, or not deleting a marker whose removal changes no character, would leave nothing for the check to see.
