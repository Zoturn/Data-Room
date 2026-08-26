import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges conditional classes so a later utility wins instead of both being emitted. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
