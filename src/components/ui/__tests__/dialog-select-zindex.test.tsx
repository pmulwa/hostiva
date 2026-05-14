import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Regression test for the bug where Select / Popover / DropdownMenu content
 * rendered BEHIND a Dialog because the global
 * `[data-radix-popper-content-wrapper]` rule pinned popper z-index to 100,
 * below the dialog content's z-[101].
 *
 * The fix lives in src/index.css where the popper wrapper is forced to
 * z-index: 200. This test asserts the stacking contract holds.
 */
describe("Dialog + Select z-index stacking", () => {
  // Pull the real rule from index.css so the test fails if anyone lowers it
  // back below the dialog z-index.
  let popperZIndex = 0;
  beforeAll(() => {
    const css = readFileSync(
      resolve(__dirname, "../../../index.css"),
      "utf8",
    );
    const match = css.match(
      /\[data-radix-popper-content-wrapper\][^{]*\{[^}]*z-index:\s*(\d+)/i,
    );
    expect(match, "popper z-index rule must exist in index.css").not.toBeNull();
    popperZIndex = Number.parseInt(match![1], 10);

    // Inject just enough CSS so jsdom's getComputedStyle resolves z-index.
    const style = document.createElement("style");
    style.textContent = `
      [data-radix-popper-content-wrapper] { z-index: ${popperZIndex} !important; }
      [role="dialog"] { z-index: 101; }
    `;
    document.head.appendChild(style);
  });

  function Harness() {
    return (
      <Dialog defaultOpen>
        <DialogTrigger>open</DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <Select defaultOpen>
            <SelectTrigger data-testid="trigger">
              <SelectValue placeholder="Pick" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
              <SelectItem value="c">Option C</SelectItem>
            </SelectContent>
          </Select>
        </DialogContent>
      </Dialog>
    );
  }

  it("popper wrapper z-index in index.css is above the dialog layer", () => {
    // Dialog content uses z-[101] in dialog.tsx.
    expect(popperZIndex).toBeGreaterThan(101);
  });

  it("renders the Select dropdown above the Dialog surface", () => {
    render(<Harness />);

    // Dialog content uses Tailwind z-[101].
    const dialogContent = document.querySelector(
      '[role="dialog"]',
    ) as HTMLElement | null;
    expect(dialogContent).not.toBeNull();

    // Open the select if it didn't auto-open in jsdom.
    const trigger = screen.getByTestId("trigger");
    if (!document.querySelector("[data-radix-popper-content-wrapper]")) {
      fireEvent.click(trigger);
    }

    const popper = document.querySelector(
      "[data-radix-popper-content-wrapper]",
    ) as HTMLElement | null;
    expect(popper, "Select popper must be mounted").not.toBeNull();

    const dialogZ = Number.parseInt(
      getComputedStyle(dialogContent!).zIndex || "0",
      10,
    );
    const popperZ = Number.parseInt(
      getComputedStyle(popper!).zIndex || "0",
      10,
    );
    expect(popperZ).toBeGreaterThan(dialogZ);
  });

  it("dialog overlay does not exceed popper z-index", () => {
    render(<Harness />);
    const overlay = document.querySelector(
      '[data-radix-dialog-overlay], [class*="fixed inset-0"]',
    ) as HTMLElement | null;
    if (!overlay) return;
    const overlayZ = Number.parseInt(
      getComputedStyle(overlay).zIndex || "0",
      10,
    );
    // Popper wrapper is forced to 200 via the injected rule.
    expect(overlayZ).toBeLessThan(200);
  });
});