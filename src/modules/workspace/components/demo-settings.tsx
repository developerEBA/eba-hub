"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { z } from "zod";
const preferences = z.object({
  displayName: z.string().trim().min(2, "Use at least two characters.").max(80),
  theme: z.enum(["light", "dark"]),
});
type Preferences = z.infer<typeof preferences>;
export function DemoSettings() {
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Preferences>({
    resolver: zodResolver(preferences),
    defaultValues: { displayName: "Sample teammate", theme: "light" },
  });
  return (
    <form
      className="max-w-xl space-y-5 rounded-xl border border-border bg-card p-6"
      onSubmit={handleSubmit((values) => {
        document.documentElement.setAttribute("data-theme", values.theme);
        setSaved(true);
      })}
    >
      <p className="eyebrow">LOCAL PRESENTATION PREFERENCES</p>
      <label className="block text-sm">
        Preview display name
        <input
          className="mt-2 block w-full rounded border border-border bg-background p-3"
          {...register("displayName")}
          aria-invalid={!!errors.displayName}
          aria-describedby="name-error"
        />
      </label>
      <p id="name-error" className="text-sm" role="status">
        {errors.displayName?.message}
      </p>
      <label className="block text-sm">
        Theme
        <select
          className="ml-3 rounded border border-border bg-background p-2"
          {...register("theme")}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <button
        className="rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground"
        type="submit"
      >
        Apply preview preferences
      </button>
      <p className="text-sm text-muted-foreground" role="status">
        {saved
          ? "Theme applied for this session. Display name validated but not saved to an employee account."
          : "These settings do not update an employee account. Theme resets on reload."}
      </p>
    </form>
  );
}
