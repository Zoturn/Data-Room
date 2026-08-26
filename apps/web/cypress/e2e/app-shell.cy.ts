describe("the app shell", () => {
  it("sends a visitor arriving at the root somewhere they can act", () => {
    cy.visit("/");

    // The root is a redirect rather than a page of its own: it resolves to the visitor's
    // Data Room, and for a signed-out visitor the route gate resolves that to sign-in.
    // Asserting the destination rather than the redirect keeps this honest if the chain
    // grows a step.
    cy.location("pathname", { timeout: 20_000 }).should("include", "sign-in");
    cy.findByRoleName("heading", "Sign in").should("be.visible");
    cy.title().should("eq", "Sign in · Data Room");
  });

  it("shows a real not-found page rather than a dead end", () => {
    cy.visit("/does-not-exist", { failOnStatusCode: false });

    cy.contains("This page does not exist").should("be.visible");
    // A dead end with no way back is the failure this page exists to prevent.
    cy.findByRoleName("link", "Back to the Data Room").should("have.attr", "href", "/");
  });
});
