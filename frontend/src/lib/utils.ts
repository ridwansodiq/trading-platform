import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design uses a custom 10–15px type scale (`text-cell-2`, `text-body-2`, …).
 * `tailwind-merge` cannot tell those apart from colour utilities like
 * `text-ink-4`, so by default it treats `text-body-2` as a colour and silently
 * drops whatever colour class it was merged with. Declaring the scale here
 * keeps size and colour in separate conflict groups.
 */
const FONT_SIZES = [
  "micro",
  "micro-2",
  "mini",
  "mini-2",
  "cell",
  "cell-2",
  "body",
  "body-2",
  "title"
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }]
    }
  }
});

/** Merge conditional class names, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
