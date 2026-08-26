import { redirect } from "next/navigation";

/**
 * The root is not a page in its own right — a signed-in user belongs in their Data Room, and
 * a signed-out one belongs at sign-in. `/rooms` resolves the caller's room and forwards to
 * its root folder; the route group's gate handles the signed-out case.
 */
export default function HomePage() {
  redirect("/rooms");
}
