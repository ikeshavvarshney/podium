"use client";

import { useLayoutEffect } from "react";

/**
 * Eases each .reveal block in once as it nears the viewport. Hidden styles only
 * apply after this runs (the .reveal-on class), so the page reads fine without
 * JavaScript, and blocks already on screen are marked before first paint.
 */
export function RevealObserver() {
  useLayoutEffect(() => {
    const root = document.querySelector(".home");
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) return;

    root.classList.add("reveal-on");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.88) el.classList.add("in");
      else io.observe(el);
    }
    return () => {
      io.disconnect();
      root.classList.remove("reveal-on");
    };
  }, []);
  return null;
}
