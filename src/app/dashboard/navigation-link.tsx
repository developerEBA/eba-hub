"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

// Fetch the complete destination when someone intends to navigate, rather than
// fetching every staff page and its database queries as soon as the sidebar mounts.
export function NavigationLink(props: ComponentProps<typeof Link>) {
  const [prefetch, setPrefetch] = useState<true | null>(null);
  return <Link {...props} prefetch={prefetch}
    onMouseEnter={() => setPrefetch(true)}
    onFocus={() => setPrefetch(true)}
    onTouchStart={() => setPrefetch(true)} />;
}
