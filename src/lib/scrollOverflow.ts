/**
 * Pure helper: returns true when the scroll-down affordance should be visible
 * for a Radix ScrollArea viewport.
 *
 * Visibility rules:
 *   • Hide when content fits (no overflow → no need to scroll).
 *   • Hide once the viewer has scrolled within `slack` px of the bottom.
 *
 * Extracted into a pure function so the React effect AND a unit test can
 * exercise the exact same logic without rendering the dialog.
 */
export function shouldShowScrollDown(
  scrollHeight: number,
  clientHeight: number,
  scrollTop: number,
  slack = 24,
): boolean {
  const overflow = scrollHeight - clientHeight;
  if (overflow <= slack) return false;
  const remaining = overflow - scrollTop;
  return remaining > slack;
}