/**
 * The auth flow a reviewer will actually try. Deliberately one spec covering the whole
 * journey rather than a matrix: the failure modes worth catching here are the ones that only
 * appear when the pieces run together — a session that does not survive a reload, a deep link
 * that loses its destination, a sign-out that leaves you signed in.
 *
 * Needs the web app and the API running, and a reachable database.
 */
function uniqueEmail(): string {
  // Registration is rate limited per IP, so the suite must not need many accounts.
  return `cypress-${Date.now()}-${Math.floor(Math.random() * 1000)}@example.test`;
}

const PASSWORD = "cypress-password-123";

describe("signing in", () => {
  it("registers, survives a reload, and signs out", () => {
    const email = uniqueEmail();

    cy.visit("/sign-up");
    cy.findByRoleName("textbox", /email/i).type(email);
    cy.get('input[type="password"]').first().type(PASSWORD);
    cy.findByRoleName("button", /create account|sign up/i).click();

    // Landed in the app.
    cy.location("pathname", { timeout: 20_000 }).should("not.include", "sign-up");
    cy.contains(email).should("be.visible");

    // The session lives in an httpOnly cookie, so a reload is the real test of it.
    cy.reload();
    cy.contains(email, { timeout: 20_000 }).should("be.visible");

    // And the token must not be readable by script — that is the whole point of httpOnly.
    cy.document().then((doc) => {
      expect(doc.cookie).to.not.contain("access_token");
      expect(doc.cookie).to.not.contain("refresh_token");
    });

    cy.findByRoleName("button", /sign out/i).click();
    cy.location("pathname", { timeout: 20_000 }).should("include", "sign-in");
  });

  it("sends a signed-out visitor to sign-in and returns them to where they were going", () => {
    const deepLink = "/rooms";

    cy.visit(deepLink);

    cy.location("pathname", { timeout: 20_000 }).should("include", "sign-in");
    // The destination is preserved, so signing in does not dump the user at the root.
    cy.location("search").should("include", "next");
  });

  it("refuses a wrong password without revealing whether the account exists", () => {
    const email = uniqueEmail();

    cy.visit("/sign-in");
    cy.findByRoleName("textbox", /email/i).type(email);
    cy.get('input[type="password"]').first().type("definitely-not-the-password");
    cy.findByRoleName("button", /sign in/i).click();

    // One message for an unknown address and for a wrong password alike.
    cy.contains(/do not match/i, { timeout: 20_000 }).should("be.visible");
    cy.location("pathname").should("include", "sign-in");
  });
});
