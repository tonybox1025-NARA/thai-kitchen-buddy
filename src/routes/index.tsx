import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { UtensilsCrossed } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { LanguageToggle } from "@/components/LanguageToggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Capacitor } from "@capacitor/core";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { loading, session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !session) return;
    const standalone = typeof window !== "undefined"
      && window.matchMedia("(display-mode: standalone)").matches;
    if (!Capacitor.isNativePlatform() && standalone) {
      const saved = window.localStorage.getItem("lonmoh:last-app-section");
      if (saved === "/live" || saved === "/crew" || saved === "/pos") {
        void navigate({ to: saved, replace: true });
        return;
      }
    }
    // Morning open: if no register/shift is open yet, land on the Register (open
    // + count starting cash) instead of the tables page; otherwise go to tables.
    void (async () => {
      const { data: shifts } = await supabase.from("shifts").select("id").eq("status", "open")
        .order("opened_at", { ascending: false }).limit(1);
      const shift = shifts?.[0] ?? null;
      void navigate({ to: shift ? "/pos" : "/register", replace: true });
    })();
  }, [loading, session, navigate]);

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-background to-muted p-4">
      <div className="absolute top-4 right-4"><LanguageToggle /></div>
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center mb-2">
            <UtensilsCrossed className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">เข้าใช้งานเครื่อง</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Label htmlFor="preview-email">อีเมล</Label>
              <Input id="preview-email" type="email" autoComplete="email" readOnly />
            </div>
            <div>
              <Label htmlFor="preview-password">รหัสผ่าน</Label>
              <Input id="preview-password" type="password" autoComplete="current-password" readOnly />
            </div>
            <Button className="w-full" size="lg" onClick={() => void navigate({ to: "/login", replace: true })}>
              เข้าสู่ระบบ
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
