const INTERACTIVE_SELECTOR =
  "a, button, [role='button'], [role='link'], [role='menuitem'], [role='tab'], input, select, textarea, label, summary";

function interactiveAncestor(el: Element): Element {
  return el.closest(INTERACTIVE_SELECTOR) ?? el;
}

function attrSelector(attr: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `[${attr}="${escaped}"]`;
}

function matchesUniquely(sel: string): boolean {
  try {
    return document.querySelectorAll(sel).length === 1;
  } catch {
    return false;
  }
}

/**
 * Generate a robust CSS selector for a DOM element.
 * Priority: data-testid > id > name > aria-label > unique short CSS path.
 * If the clicked element is a child of an interactive element (e.g. an svg
 * inside a button), we target the interactive ancestor instead.
 */
export function generateSelector(el: Element): string {
  el = interactiveAncestor(el);

  // 1. data-testid
  const testId = el.getAttribute("data-testid");
  if (testId) return attrSelector("data-testid", testId);

  // 2. id (if unique on page)
  if (el.id) {
    const sel = `#${CSS.escape(el.id)}`;
    if (matchesUniquely(sel)) return sel;
  }

  // 3. name attribute for form elements
  const name = el.getAttribute("name");
  if (name) {
    const sel = `${el.tagName.toLowerCase()}${attrSelector("name", name)}`;
    if (matchesUniquely(sel)) return sel;
  }

  // 4. aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    const sel = attrSelector("aria-label", ariaLabel);
    if (matchesUniquely(sel)) return sel;
  }

  // 5. Build a path from the element up
  return buildCssPath(el);
}

function buildCssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id && matchesUniquely(`#${CSS.escape(current.id)}`)) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    // Add class names that help narrow it down (skip generic utility classes)
    const meaningful = Array.from(current.classList).filter(
      (c) => !isUtilityClass(c) && c.length < 40
    );
    if (meaningful.length > 0) {
      selector += "." + meaningful.slice(0, 2).map(CSS.escape).join(".");
    }

    // Add nth-child if still ambiguous among siblings
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (s) => s.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);

    // Check if we have a unique selector already
    const candidate = parts.join(" > ");
    if (matchesUniquely(candidate)) return candidate;

    current = current.parentElement;
  }

  return parts.join(" > ");
}

/** Filter out common utility/generated class names that aren't stable selectors */
function isUtilityClass(cls: string): boolean {
  // Tailwind-style, CSS modules hashes, etc.
  return (
    /^[a-z]{1,3}-/.test(cls) ||
    /[_-][a-zA-Z0-9]{5,}$/.test(cls) ||
    /^css-/.test(cls) ||
    /^_/.test(cls)
  );
}

/** Get a human-readable label for the element */
export function getElementLabel(el: Element): string {
  el = interactiveAncestor(el);
  const text = (el.textContent || "").trim().slice(0, 50);
  const ariaLabel = el.getAttribute("aria-label");
  const placeholder = el.getAttribute("placeholder");
  return ariaLabel || placeholder || text || el.tagName.toLowerCase();
}
