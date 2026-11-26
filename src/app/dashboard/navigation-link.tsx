"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";



export function NavigationLink(props: ComponentProps<typeof Link>) {
  const [prefetch, setPrefetch] = useState<true | null>(null);
  return <Link {...props} prefetch={prefetch}
    onMouseEnter={() => setPrefetch(true)}
    onFocus={() => setPrefetch(true)}
    onTouchStart={() => setPrefetch(true)} />;
}
