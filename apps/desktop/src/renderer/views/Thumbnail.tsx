/**
 * A small preview of a picture in a list row.
 *
 * It asks for the preview only once the row is on screen, and shows the
 * row's usual icon until one arrives (or for good, when the file is not a
 * picture). The picture is decorative: the row's name is beside it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import "./Thumbnail.css";

export interface ThumbnailBridge {
  getImageThumbnail?(request: { module: "drop" | "capture"; id: string }): Promise<string | null>;
}

export function Thumbnail({ bridge, module, id, fallback, className }: { bridge: ThumbnailBridge; module: "drop" | "capture"; id: string; fallback: ReactNode; className?: string }) {
  const holder = useRef<HTMLSpanElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const element = holder.current;
    if (!element || !bridge.getImageThumbnail) return;
    let live = true;
    let asked = false;
    const ask = () => {
      if (asked) return;
      asked = true;
      void bridge.getImageThumbnail?.({ module, id }).then((url) => { if (live && typeof url === "string" && url.startsWith("data:image/")) setSrc(url); }).catch(() => undefined);
    };
    // Without an observer (an old runtime, or a test), ask straight away.
    if (typeof IntersectionObserver === "undefined") {
      ask();
      return () => { live = false; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        ask();
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => { live = false; observer.disconnect(); };
  }, [bridge, module, id]);

  return (
    <span ref={holder} className={className ?? "thumbnail"}>
      {src ? <img src={src} alt="" className="thumbnail-image" /> : fallback}
    </span>
  );
}
