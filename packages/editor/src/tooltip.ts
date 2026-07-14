/**
 * A hover/focus tooltip that renders a shortcut key badge (styled like the
 * shortcuts legend) followed by a label — e.g. `[S] Split at playhead`. Used as
 * a Svelte action so any button can opt in: `use:tooltip={{ key, label }}`.
 *
 * The bubble is appended to <body> and fixed-positioned so toolbar overflow
 * can't clip it. `key` is optional — omit it for buttons without a shortcut.
 */
export interface TooltipOptions {
  key?: string;
  label: string;
}

export function tooltip(node: HTMLElement, options: TooltipOptions) {
  let current = options;
  let bubble: HTMLDivElement | null = null;

  function render(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "ds-tip";
    el.setAttribute("role", "tooltip");
    if (current.key) {
      const kbd = document.createElement("kbd");
      kbd.className = "ds-tip-key";
      kbd.textContent = current.key;
      el.appendChild(kbd);
    }
    const label = document.createElement("span");
    label.textContent = current.label;
    el.appendChild(label);
    return el;
  }

  function place(): void {
    if (!bubble) return;
    const anchor = node.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    const left = Math.min(
      Math.max(6, anchor.left + anchor.width / 2 - size.width / 2),
      window.innerWidth - size.width - 6
    );
    // Prefer below the control; flip above if it would run off the bottom.
    const below = anchor.bottom + 8;
    const top =
      below + size.height > window.innerHeight - 6
        ? anchor.top - size.height - 8
        : below;
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  function show(): void {
    if (bubble) return;
    bubble = render();
    // Mount inside the themed container so the --ds-* variables (and dark/light
    // mode) resolve; <body> is outside them, which renders it unstyled.
    const host =
      node.closest<HTMLElement>(".ds-editor, .ds-app") ?? document.body;
    host.appendChild(bubble);
    place();
  }

  function hide(): void {
    bubble?.remove();
    bubble = null;
  }

  node.addEventListener("mouseenter", show);
  node.addEventListener("mouseleave", hide);
  node.addEventListener("focus", show);
  node.addEventListener("blur", hide);
  node.addEventListener("click", hide);

  return {
    update(next: TooltipOptions) {
      current = next;
      if (bubble) {
        hide();
        show();
      }
    },
    destroy() {
      hide();
      node.removeEventListener("mouseenter", show);
      node.removeEventListener("mouseleave", hide);
      node.removeEventListener("focus", show);
      node.removeEventListener("blur", hide);
      node.removeEventListener("click", hide);
    },
  };
}
