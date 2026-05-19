import { createFileRoute, redirect } from "@tanstack/react-router";

// trigger preview refresh
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/pos" });
  },
});
