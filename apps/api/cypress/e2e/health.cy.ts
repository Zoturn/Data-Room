describe("GET /api/health", () => {
  it("reports the service and its database", () => {
    cy.request("/api/health").then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.deep.eq({ status: "ok", database: "up" });
    });
  });

  it("needs no authentication, so a deploy platform can poll it", () => {
    // No cookie is sent here; the endpoint must still answer.
    cy.request({ url: "/api/health", headers: { Cookie: "" } })
      .its("status")
      .should("eq", 200);
  });

  it("stamps every response with a request id for log correlation", () => {
    cy.request("/api/health").then((response) => {
      expect(response.headers).to.have.property("x-request-id");
    });
  });

  it("returns the uniform error envelope for an unknown route", () => {
    cy.request({ url: "/api/nope", failOnStatusCode: false }).then((response) => {
      expect(response.status).to.eq(404);
      expect(response.body).to.include.keys("code", "message", "requestId");
      expect(response.body.code).to.eq("NOT_FOUND");
      // Nothing internal may leak to a caller.
      expect(JSON.stringify(response.body)).to.not.contain("at ");
    });
  });
});
