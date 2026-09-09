/**
 * Drag geometry.
 *
 * Every case here is one where the selection looks right on screen and the
 * crop comes back wrong, which is the failure mode that cannot be spotted by
 * using the feature - the picture is plausible, just not the one chosen.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { MIN_DRAG, overlayHtml, rectFromDrag, SELECTION_SCRIPT } from "../src/main/captureRegion.ts";

const image = { width: 3840, height: 2160 };

test("a straightforward drag becomes the same rectangle", () => {
  assert.deepEqual(
    rectFromDrag({ x1: 100, y1: 50, x2: 300, y2: 150 }, 1, { width: 1920, height: 1080 }),
    { x: 100, y: 50, width: 200, height: 100 }
  );
});

test("dragging up and to the left selects the same region as down and right", () => {
  // Only one of the two directions produces a positive width the naive way,
  // and a person choosing a region does not think about which corner is first.
  const downRight = rectFromDrag({ x1: 100, y1: 50, x2: 300, y2: 150 }, 1, image);
  const upLeft = rectFromDrag({ x1: 300, y1: 150, x2: 100, y2: 50 }, 1, image);
  assert.deepEqual(upLeft, downRight);
});

test("a scaled display crops physical pixels, not CSS ones", () => {
  // The overlay measures in CSS pixels and the captured bitmap is physical. On
  // a 200% display, ignoring this crops the top-left quarter of the selection
  // and the result still looks like a screenshot of something.
  assert.deepEqual(
    rectFromDrag({ x1: 100, y1: 50, x2: 300, y2: 150 }, 2, image),
    { x: 200, y: 100, width: 400, height: 200 }
  );
});

test("a fractional scale factor rounds outward", () => {
  // A selection that visually contains a character must not lose its last
  // column to a rounding step, because the missing column is a missing letter.
  const rect = rectFromDrag({ x1: 10, y1: 10, x2: 110, y2: 60 }, 1.5, image)!;
  assert.equal(rect.width, 150);
  assert.equal(rect.height, 75);
});

test("a click is not a selection", () => {
  // Cropping a sliver hands OCR nothing and gets an empty string back, which
  // reads as "OCR failed" rather than "you did not select anything".
  assert.equal(rectFromDrag({ x1: 100, y1: 100, x2: 100, y2: 100 }, 1, image), null);
  assert.equal(rectFromDrag({ x1: 100, y1: 100, x2: 104, y2: 130 }, 1, image), null);
});

test("a drag of exactly the minimum is accepted", () => {
  assert.notEqual(rectFromDrag({ x1: 0, y1: 0, x2: MIN_DRAG, y2: MIN_DRAG }, 1, image), null);
});

test("a drag released past the edge is clamped to the image", () => {
  // A pointer released beyond the screen reports a coordinate that is not on
  // it, and a crop running past the bitmap is an error rather than a smaller
  // picture.
  const rect = rectFromDrag({ x1: 1800, y1: 1000, x2: 2200, y2: 1400 }, 1, { width: 1920, height: 1080 })!;
  assert.equal(rect.x + rect.width, 1920);
  assert.equal(rect.y + rect.height, 1080);
});

test("negative coordinates are clamped rather than trusted", () => {
  const rect = rectFromDrag({ x1: -50, y1: -20, x2: 100, y2: 100 }, 1, image)!;
  assert.equal(rect.x, 0);
  assert.equal(rect.y, 0);
});

test("an implausible scale factor is treated as 1:1", () => {
  // Shrinking the crop rather than failing is the hardest kind of wrong to
  // notice, because the result is still a picture of something.
  assert.deepEqual(
    rectFromDrag({ x1: 0, y1: 0, x2: 100, y2: 100 }, 0.5, image),
    { x: 0, y: 0, width: 100, height: 100 }
  );
  assert.deepEqual(
    rectFromDrag({ x1: 0, y1: 0, x2: 100, y2: 100 }, Number.NaN, image),
    { x: 0, y: 0, width: 100, height: 100 }
  );
});

test("a drag entirely outside the image selects nothing", () => {
  assert.equal(rectFromDrag({ x1: 2000, y1: 2000, x2: 2400, y2: 2400 }, 1, { width: 1920, height: 1080 }), null);
});

test("the overlay embeds the image it was given", () => {
  assert.match(overlayHtml("file:///tmp/shot.png"), /src="file:\/\/\/tmp\/shot\.png"/);
});

test("every way out of the overlay resolves it", () => {
  // A full-screen window that never settles is a locked machine. Escape, a
  // right-click and losing focus all have to end it, not only a completed drag.
  for (const exit of ["Escape", "blur", "button !== 0"]) {
    assert.ok(SELECTION_SCRIPT.includes(exit), `${exit} does not end the overlay`);
  }
});
