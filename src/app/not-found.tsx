import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-content-center gap-5 p-8 text-center">
      <p className="eyebrow">EBA HUB · 404</p>
      <h1 className="page-title">This page isn’t in the workspace</h1>
      <Button asChild>
        <Link href="/dashboard">Back to overview</Link>
      </Button>
    </main>
  );
}
