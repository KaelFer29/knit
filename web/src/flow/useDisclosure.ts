import { useId, useState } from "react";

/**
 * State for a disclosure widget: a focusable button with `aria-expanded` that opens a panel.
 * A native `<button>` already toggles on Enter and Space, so the widget only wires the attributes.
 */
export function useDisclosure(defaultOpen = false) {
  const panelId = useId();
  const [open, setOpen] = useState(defaultOpen);
  return {
    open,
    panelId,
    triggerProps: {
      type: "button" as const,
      "aria-expanded": open,
      // The panel exists only while open, so it can only be referenced then.
      "aria-controls": open ? panelId : undefined,
      onClick: () => setOpen((value) => !value),
    },
  };
}
