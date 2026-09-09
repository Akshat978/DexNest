/**
 * Turning a drag on an overlay into a rectangle of screen pixels.
 *
 * The geometry is separated from the window that collects it because this is
 * where the mistakes live. A drag has no guaranteed direction, an overlay is
 * measured in CSS pixels while the captured image is in physical ones, and a
 * display with a scale factor makes those two disagree by exactly the amount
 * that turns a correct-looking selection into a crop of the wrong thing.
 */

/** A drag, exactly as the overlay reported it. Either corner may be first. */
export interface DragPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest selection worth sending to OCR, in CSS pixels. */
export const MIN_DRAG = 8;

/**
 * Normalises a drag into a rectangle of image pixels.
 *
 * Returns null for a selection too small to be meant - a click, or a drag of a
 * few pixels while deciding. Cropping that would hand OCR a sliver and get back
 * an empty string, which reads as "OCR failed" rather than "nothing was
 * selected".
 *
 * Clamped to the image because a drag can end outside the overlay: a pointer
 * released past the edge of the screen reports a coordinate that is not on it,
 * and a crop rectangle running past the bitmap is an error rather than a
 * smaller picture.
 */
export function rectFromDrag(
  drag: DragPoints,
  scaleFactor: number,
  image: { width: number; height: number }
): PixelRect | null {
  // Direction-independent: dragging up-left is as ordinary as down-right, and
  // only one of those produces positive width the naive way.
  const left = Math.min(drag.x1, drag.x2);
  const top = Math.min(drag.y1, drag.y2);
  const cssWidth = Math.abs(drag.x2 - drag.x1);
  const cssHeight = Math.abs(drag.y2 - drag.y1);

  if (cssWidth < MIN_DRAG || cssHeight < MIN_DRAG) return null;

  // A scale factor below 1 is not a display DexNest has ever seen and would
  // shrink the crop rather than fail, which is the hardest kind of wrong to
  // notice. Treat anything implausible as 1:1.
  const scale = Number.isFinite(scaleFactor) && scaleFactor >= 1 ? scaleFactor : 1;

  const x = Math.max(0, Math.round(left * scale));
  const y = Math.max(0, Math.round(top * scale));
  // Rounded outward, so a selection that visually contains a character does not
  // lose its last column to a rounding step.
  const width = Math.min(Math.ceil(cssWidth * scale), image.width - x);
  const height = Math.min(Math.ceil(cssHeight * scale), image.height - y);

  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * The page shown over the frozen screenshot.
 *
 * Returned as a string rather than a file so the overlay has no build step and
 * cannot drift from the code that reads its result. The selection is collected
 * by executeJavaScript rather than IPC, which keeps the window free of a
 * preload and of node integration - it displays a picture of the operator's
 * screen, so the less it can reach, the better.
 */
export function overlayHtml(imageSrc: string): string {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; cursor: crosshair; }
  #shot { position: fixed; inset: 0; width: 100vw; height: 100vh; -webkit-user-select: none; user-select: none; -webkit-user-drag: none; }
  /* The dim sits above the screenshot and below the selection, so the region
     being chosen is the only part shown at full brightness. */
  #dim { position: fixed; inset: 0; background: rgba(0,0,0,0.45); }
  #sel { position: fixed; display: none; border: 1px solid #14B8A6; box-shadow: 0 0 0 9999px rgba(0,0,0,0.45); }
  #hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
          font: 12px system-ui, sans-serif; color: #F5F5F5; background: rgba(10,10,10,0.85);
          border: 1px solid #262626; border-radius: 8px; padding: 6px 12px; }
</style>
<img id="shot" src="${imageSrc}" draggable="false">
<div id="dim"></div>
<div id="sel"></div>
<div id="hint">Drag to select text · Esc to cancel</div>`;
}

/**
 * The selection script, evaluated in the overlay.
 *
 * Resolves with a drag or with null when cancelled. Every exit resolves rather
 * than rejecting or hanging: an overlay covering the screen that never settles
 * is a locked machine, so a right-click, an Escape and a blur all end it.
 */
export const SELECTION_SCRIPT = `new Promise(resolve => {
  const sel = document.getElementById("sel");
  const dim = document.getElementById("dim");
  let start = null;
  let settled = false;

  const finish = value => { if (!settled) { settled = true; resolve(value); } };

  const paint = (event) => {
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    sel.style.left = x + "px";
    sel.style.top = y + "px";
    sel.style.width = Math.abs(event.clientX - start.x) + "px";
    sel.style.height = Math.abs(event.clientY - start.y) + "px";
  };

  window.addEventListener("mousedown", event => {
    if (event.button !== 0) { finish(null); return; }
    start = { x: event.clientX, y: event.clientY };
    // The full-screen dim is replaced by the selection's own outset shadow, so
    // that the chosen region is the one part at full brightness.
    dim.style.display = "none";
    sel.style.display = "block";
    paint(event);
  });
  window.addEventListener("mousemove", event => { if (start) paint(event); });
  window.addEventListener("mouseup", event => {
    if (!start) return;
    finish({ x1: start.x, y1: start.y, x2: event.clientX, y2: event.clientY });
  });

  window.addEventListener("keydown", event => { if (event.key === "Escape") finish(null); });
  // Losing focus means something else took the screen. Continuing to sit on
  // top of it, invisible and swallowing clicks, is the worst failure this can
  // have.
  window.addEventListener("blur", () => finish(null));
})`;
