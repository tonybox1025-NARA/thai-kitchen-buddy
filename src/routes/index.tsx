import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    void navigate({ to: session ? "/pos" : "/login", replace: true });
  }, [loading, session, navigate]);

  return (
    <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
      กำลังเปิดหน้าจอ…
    </div>
  );
}
