"use client";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/**
 * The tab bar used under a `PageHeader`.
 *
 * `TabStrip` is the row, `TabStripItem` one tab. Both are the Radix `TabsList`
 * and `TabsTrigger`, not lookalikes: the trigger has to be the real one or the
 * click never reaches the `Tabs` that owns the selection, and the panel below
 * never changes. They used to be a `<div role="tablist">` and a plain
 * `<button>`, which rendered convincingly and did nothing — the `value` landed
 * on the button as an inert HTML attribute, and the `data-[state=active]:`
 * classes below had no `data-state` to match.
 *
 * The strip deliberately keeps its own underline-tab appearance rather than the
 * pill styling `TabsList` ships with, which is why the default background,
 * height and padding are reset here. The trigger's `value` still identifies the
 * matching `TabsContent`, so the strip holds no selection state of its own.
 */

export function TabStrip({
  className,
  children,
  ...props
}: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn(
        "h-auto w-full flex-wrap justify-start rounded-none border-b border-slate-200 bg-transparent p-0",
        className
      )}
      {...props}
    >
      {children}
    </TabsList>
  );
}

export function TabStripItem({
  className,
  children,
  ...props
}: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "-mb-px h-auto flex-none rounded-none border-b-2 border-transparent px-3 py-2 text-sm font-medium text-slate-600",
        "hover:border-slate-300 hover:text-slate-900",
        "data-[state=active]:border-teal-600 data-[state=active]:text-teal-800 data-[state=active]:shadow-none",
        "data-[state=active]:bg-transparent",
        className
      )}
      {...props}
    >
      {children}
    </TabsTrigger>
  );
}

export function TabPanel({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      role="tabpanel"
      className={cn("mt-4 focus-visible:outline-none", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export type TabStripProps = { children: ReactNode };
