"use client";

import { useEffect, useState } from "react";

const quotes = [
  "Ideas grow when we share them.",
  "Make room for the work that matters.",
  "Good work starts with a clear question.",
];

export function OfficeQuote() {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(true);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % quotes.length);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  return (
    <div className="eba-dashboard__quote">
      <blockquote aria-live={reducedMotion ? "polite" : "off"}>“{quotes[index]}”</blockquote>
      <button type="button" onClick={() => setIndex((current) => (current + 1) % quotes.length)} aria-label="Show next quote">Next quote</button>
    </div>
  );
}
