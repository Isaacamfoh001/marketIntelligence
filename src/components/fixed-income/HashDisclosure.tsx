"use client";

// A <details> that opens itself when the URL hash points at it (or at an
// element inside it), so an in-page link such as "View source evidence" lands
// on the evidence rather than on a closed disclosure. Progressive disclosure
// stays the default; the analyst's explicit navigation overrides it.

import { useEffect, useRef } from "react";

export function HashDisclosure({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}` && ref.current) ref.current.open = true;
    };
    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, [id]);
  return (
    <details ref={ref} className={className}>
      {children}
    </details>
  );
}
