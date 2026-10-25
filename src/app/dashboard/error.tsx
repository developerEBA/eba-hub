"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="py-20 text-center" role="alert">
      <h1 className="page-title">We couldn’t load your workspace</h1>
      <p className="my-4 text-muted-foreground">
        Please try again in a moment.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
