/**
 * Role-and-name selection without Testing Library, which the testing rules exclude.
 *
 * Cypress ships no role-aware selector, so this maps the roles this app actually uses onto
 * their implicit HTML elements and filters by accessible name. Selecting this way means a
 * test breaks when the accessible name breaks — which is a real regression — and survives a
 * restyle, which is not.
 *
 * Registered with `addQuery` rather than `add`: a query re-runs on every retry, so an
 * element that arrives after a fetch settles is found by the same timeout as `cy.get`.
 * A plain command would resolve once against the DOM as it was.
 */
const ROLE_SELECTORS: Record<string, string> = {
  button: 'button, [role="button"]',
  link: 'a[href], [role="link"]',
  heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
  dialog: '[role="dialog"]',
  alert: '[role="alert"]',
  status: '[role="status"]',
  progressbar: 'progress, [role="progressbar"]',
  listitem: 'li, [role="listitem"]',
  textbox: 'input:not([type="checkbox"]):not([type="radio"]), textarea, [role="textbox"]',
};

/** Elements whose accessible name comes from a `<label>` rather than their own content. */
interface Labelable {
  labels: NodeListOf<HTMLLabelElement> | null;
}

function isLabelable(element: HTMLElement): element is HTMLElement & Labelable {
  return "labels" in element;
}

function textOf(nodes: Iterable<Element>): string {
  return Array.from(nodes)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The subset of accname resolution this app needs, in specification order: an explicit
 * `aria-label`, then `aria-labelledby`, then a form control's associated `<label>`, then the
 * element's own text.
 *
 * The `<label>` step is the one that matters most here — every input in this app is labelled
 * by a real `<label htmlFor>`, and an input's own `textContent` is always empty, so without
 * it no textbox could ever be found by name.
 */
function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute("aria-label")?.trim();
  if (label !== undefined && label !== "") return label;

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const owner = element.ownerDocument;
    const targets = labelledBy.split(/\s+/).flatMap((id) => {
      const target = owner.getElementById(id);
      return target === null ? [] : [target];
    });
    const named = textOf(targets);
    if (named !== "") return named;
  }

  if (isLabelable(element) && element.labels !== null && element.labels.length > 0) {
    const named = textOf(element.labels);
    if (named !== "") return named;
  }

  return textOf([element]);
}

Cypress.Commands.addQuery(
  "findByRoleName",
  function findByRoleName(role: string, name: string | RegExp) {
    const selector = ROLE_SELECTORS[role];
    if (!selector)
      throw new Error(`No selector mapped for role "${role}". Add one in commands.ts.`);

    const matches = (value: string): boolean =>
      typeof name === "string" ? value.toLowerCase() === name.toLowerCase() : name.test(value);

    // Throwing rather than returning an empty set is what makes the query retry: Cypress
    // re-invokes this until it stops throwing or the timeout expires.
    return () => {
      const matched = cy.$$(selector).filter((_index, element) => matches(accessibleName(element)));
      if (matched.length === 0) {
        throw new Error(`No element with role "${role}" and accessible name ${String(name)}.`);
      }
      return matched.first();
    };
  },
);

declare global {
  namespace Cypress {
    interface Chainable {
      /** Finds a single element by ARIA role and accessible name. */
      findByRoleName(role: string, name: string | RegExp): Chainable<JQuery<HTMLElement>>;
    }
  }
}

export {};
