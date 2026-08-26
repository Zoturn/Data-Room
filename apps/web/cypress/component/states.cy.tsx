import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";

/**
 * These four states are the ones the brief grades hardest. Selecting by role and accessible
 * name — never a CSS class — means a failing test signals a real regression rather than a
 * restyle. See apps/web/.claude/rules/testing.md.
 */
describe("states", () => {
  it("renders skeleton rows shaped like the content that is coming", () => {
    cy.mount(<ListSkeleton rows={4} />);

    cy.get("li").should("have.length.at.least", 4);
    cy.contains("Loading").should("exist");
  });

  it("offers the next action from an empty state, rather than just saying it is empty", () => {
    const onUpload = cy.stub().as("upload");

    cy.mount(
      <EmptyState
        title="This folder is empty"
        description="Upload a PDF or create a folder to get started."
        action={<Button onClick={onUpload}>Upload files</Button>}
      />,
    );

    cy.findByRoleName("heading", "This folder is empty").should("be.visible");
    cy.findByRoleName("button", "Upload files").click();
    cy.get("@upload").should("have.been.calledOnce");
  });

  it("announces an error and offers the retry", () => {
    const onRetry = cy.stub().as("retry");

    cy.mount(<ErrorState description="We could not load this folder." onRetry={onRetry} />);

    // role="alert" is what makes the failure reach a screen reader, not just the screen.
    cy.get('[role="alert"]').should("contain.text", "We could not load this folder.");
    cy.findByRoleName("button", "Try again").click();
    cy.get("@retry").should("have.been.calledOnce");
  });

  it("renders an error without a retry when there is nothing to retry", () => {
    cy.mount(<ErrorState description="This link no longer works." />);

    cy.get('[role="alert"]').should("exist");
    cy.get("button").should("not.exist");
  });
});
