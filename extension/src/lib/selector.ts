/**
 * Generate a robust CSS selector for a DOM element.
 * Priority: data-testid > id > unique short CSS path.
 */
export function generateSelector(el: Element): string {
  // 1. data-testid
  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${testId}"]`;

  // 2. id (if unique on page)
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }

  // 3. name attribute for form elements
  const name = el.getAttribute("name");
  if (name) {
    const tag = el.tagName.toLowerCase();
    const sel = `${tag}[name="${name}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }

  // 4. aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    const sel = `[aria-label="${ariaLabel}"]`;
    if (document.querySelectorAll(sel).length === 1) return sel;
  }

  // 5. Build a path from the element up
  return buildCssPath(el);
}

function buildCssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id && document.querySelectorAll(`#${CSS.escape(current.id)}`).length === 1) {
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
    try {
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    } catch {
      // selector may be invalid, keep building
    }

    current = current.parentElement;
  }

  return parts.join(" > ");
}

/** Filter out common utility/generated class names that aren't stable selectors */
function isUtilityClass(cls: string): boolean {
  // Tailwind-style, CSS modules hashes, etc.
  return /^[a-z]{1,3}-/.test(cls) ||
    /[_-][a-zA-Z0-9]{5,}$/.test(cls) ||
    /^css-/.test(cls) ||
    /^_/.test(cls);
}

/** Get a human-readable label for the element */
export function getElementLabel(el: Element): string {
  const text = (el.textContent || "").trim().slice(0, 50);
  const ariaLabel = el.getAttribute("aria-label");
  const placeholder = el.getAttribute("placeholder");
  return ariaLabel || placeholder || text || el.tagName.toLowerCase();
}
