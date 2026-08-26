describe("the app shell", () => {
  it("renders the shell and its heading", () => {
    cy.visit("/");

    cy.findByRoleName("heading", "Data Room").should("be.visible");
    cy.title().should("eq", "Data Room");
  });

  it("shows a real not-found page rather than a dead end", () => {
    cy.visit("/does-not-exist", { failOnStatusCode: false });

    cy.contains("This page does not exist").should("be.visible");
    // A dead end with no way back is the failure this page exists to prevent.
    cy.findByRoleName("link", "Back to the Data Room").should("have.attr", "href", "/");
  });
});
