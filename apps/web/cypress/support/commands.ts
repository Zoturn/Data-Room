/**
 * Role-and-name selection without Testing Library, which the testing rules exclude.
 *
 * Cypress ships no role-aware selector, so this maps the roles this app actually uses onto
 * their implicit HTML elements and filters by accessible name. Selecting this way means a
 * test breaks when the accessible name breaks — which is a real regression — and survives a
 * restyle, which is not.
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

function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute("aria-label");
  if (label) return label.trim();

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const target = element.ownerDocument.getElementById(labelledBy);
    if (target?.textContent) return target.textContent.trim();
  }

  return (element.textContent ?? "").trim();
}

Cypress.Commands.add("findByRoleName", (role: string, name: string | RegExp) => {
  const selector = ROLE_SELECTORS[role];
  if (!selector) throw new Error(`No selector mapped for role "${role}". Add one in commands.ts.`);

  const matches = (value: string) =>
    typeof name === "string" ? value.toLowerCase() === name.toLowerCase() : name.test(value);

  return cy
    .get(selector)
    .filter((_index, element) => matches(accessibleName(element)))
    .first();
});

declare global {
  namespace Cypress {
    interface Chainable {
      /** Finds a single element by ARIA role and accessible name. */
      findByRoleName(role: string, name: string | RegExp): Chainable<JQuery<HTMLElement>>;
    }
  }
}

export {};
