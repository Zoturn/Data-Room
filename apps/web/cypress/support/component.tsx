import { mount } from "cypress/react";
import "./commands";
import "@/app/globals.css";

// Components are mounted with the app's real stylesheet, so a Cypress component test
// exercises the same tokens and focus rings the browser will.
Cypress.Commands.add("mount", mount);

declare global {
  namespace Cypress {
    interface Chainable {
      mount: typeof mount;
    }
  }
}

export {};
