/**
 * Every spec waits for the API to be genuinely ready before it runs. Polling /health is
 * how a spec avoids racing a server that is still connecting — no fixed sleeps.
 */
before(() => {
  cy.waitForApi();
});

Cypress.Commands.add("waitForApi", () => {
  const deadline = 60;

  const poll = (attempt: number): Cypress.Chainable<void> => {
    if (attempt > deadline) {
      throw new Error(
        `The API did not become healthy in ${deadline} attempts. Start it with ` +
          `\`pnpm --filter @data-room/api dev\` before running these specs.`,
      );
    }

    return cy.request({ url: "/api/health", failOnStatusCode: false }).then((response) => {
      if (response.status === 200 && response.body?.database === "up") {
        return;
      }
      return cy.wait(500).then(() => poll(attempt + 1));
    });
  };

  return poll(1);
});

declare global {
  namespace Cypress {
    interface Chainable {
      /** Polls /api/health until the service and its database are both up. */
      waitForApi(): Chainable<void>;
    }
  }
}

export {};
