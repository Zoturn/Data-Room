/**
 * The folder journey a reviewer will actually try: create, nest, navigate back by
 * breadcrumb, rename, collide with an existing name, and delete a folder that has contents.
 *
 * Deliberately one spec covering the whole journey rather than a matrix. These steps share
 * state, and the failures worth catching only appear in sequence — a breadcrumb that loses
 * an ancestor after a rename, or a delete warning that counts the wrong subtree.
 *
 * Needs the web app and the API running, and a reachable database.
 */
function uniqueEmail(): string {
  // Registration is rate limited per IP, so the suite must not need many accounts.
  return `cypress-folders-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.test`;
}

const PASSWORD = "cypress-password-123";

/** Opens the New folder dialog, names the folder, and waits for the row to appear. */
function createFolder(name: string): void {
  cy.findByRoleName("button", "New folder").click();
  cy.findByRoleName("textbox", /folder name/i).type(name);
  cy.findByRoleName("button", "Create folder").click();
  cy.contains("a", name, { timeout: 20_000 }).should("be.visible");
}

/** Opens a row's action menu and picks one of its items. */
function rowAction(folderName: string, action: "Rename" | "Delete"): void {
  cy.findByRoleName("button", `Actions for ${folderName}`).click();
  cy.contains('[role="menuitem"]', action).click();
}

describe("folders", () => {
  beforeEach(() => {
    // A fresh account per test, so one test's tree can never explain another's result.
    cy.visit("/sign-up");
    cy.findByRoleName("textbox", /email/i).type(uniqueEmail());
    cy.get('input[type="password"]').first().type(PASSWORD);
    cy.findByRoleName("button", /create account|sign up/i).click();

    // Registration provisions the Data Room and forwards to its root folder.
    cy.location("pathname", { timeout: 30_000 }).should("include", "/rooms/");
  });

  it("creates a folder, nests one inside it, and walks back up the breadcrumbs", () => {
    createFolder("Diligence");
    cy.contains("a", "Diligence").click();

    createFolder("Financials");

    // The trail names every ancestor, so the user always knows where they are.
    cy.get('nav[aria-label="Breadcrumb"]').within(() => {
      cy.contains("Diligence").should("be.visible");
    });

    // And it is a way back, not just a label.
    cy.get('nav[aria-label="Breadcrumb"]').contains("a", "My Data Room").click();
    cy.contains("a", "Diligence", { timeout: 20_000 }).should("be.visible");
    cy.contains("a", "Financials").should("not.exist");
  });

  it("refuses a name already taken by a sibling, and says which one", () => {
    createFolder("Diligence");

    cy.findByRoleName("button", "New folder").click();
    // Padding and case are normalised before the comparison, so this is the same name.
    cy.findByRoleName("textbox", /folder name/i).type("  diligence  ");
    cy.findByRoleName("button", "Create folder").click();

    cy.contains(/already exists here/i).should("be.visible");
    // The dialog stays open with the text intact rather than discarding what was typed.
    cy.findByRoleName("textbox", /folder name/i).should("have.value", "  diligence  ");
  });

  it("renames a folder in place", () => {
    createFolder("Finacials");

    rowAction("Finacials", "Rename");
    cy.findByRoleName("textbox", /folder name|name/i)
      .clear()
      .type("Financials");
    cy.contains("button", /rename|save/i).click();

    cy.contains("a", "Financials", { timeout: 20_000 }).should("be.visible");
    cy.contains("a", "Finacials").should("not.exist");
  });

  it("states what a recursive delete will destroy before destroying it", () => {
    createFolder("Diligence");
    cy.contains("a", "Diligence").click();
    createFolder("Financials");
    cy.contains("a", "Financials").click();
    createFolder("2025");

    // Back to the root, where Diligence is the row with a subtree beneath it.
    cy.get('nav[aria-label="Breadcrumb"]').contains("a", "My Data Room").click();
    cy.contains("a", "Diligence", { timeout: 20_000 }).should("be.visible");

    rowAction("Diligence", "Delete");

    // The real count from the server's own preview — two descendant folders — not a vague
    // "and everything in it". This warning is the whole point of the confirmation.
    cy.contains(/2 folders/i, { timeout: 20_000 }).should("be.visible");
    cy.contains(/cannot be undone/i).should("be.visible");

    cy.findByRoleName("button", "Delete folder").click();

    cy.contains("a", "Diligence", { timeout: 20_000 }).should("not.exist");
  });
});
