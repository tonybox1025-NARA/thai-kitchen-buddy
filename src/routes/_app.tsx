import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";
import { PinKeypad } from "@/components/PinKeypad";
import { Button } from "@/components/ui/button";
import { LayoutGrid, BarChart3, FileText, Settings, LogOut, UserCircle2 } from "lucide-react";
import { installAudioUnlockListeners, unlockAudio } from "@/lib/audio-alert";
import { useQrAlertCount } from "@/lib/qr-alert-count";

export const Route = createFileRoute("/_app")({ component: AppLayout, ssr: false });

function AppLayout() {
  const { loading, session, staff, setStaff, signOut, verifyPin } = useAuth();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [pinErr, setPinErr] = useState<string | null>(null);
  const qrAlertCount = useQrAlertCount(Boolean(session && staff));

  useEffect(() => { installAudioUnlockListeners(); }, []);

  useEffect(() => {
    if (!loading && !session) nav({ to: "/login" });
  }, [loading, session, nav]);

  useEffect(() => {
    if (!loading && !session) {
      setStaff(null);
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.replace("/login");
      }
    }
  }, [loading, session, setStaff]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">{t("loading")}</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen grid place-items-center gap-3 p-4 text-center text-muted-foreground">
        <p>{t("loading")}</p>
        <Button asChild variant="outline">
          <Link to="/login">{t("sign_in")}</Link>
        </Button>
      </div>
    );
  }

  // Staff PIN gate
  if (!staff) {
    return (
      <div className="min-h-screen grid place-items-center p-4 bg-gradient-to-br from-background to-muted">
        <div className="absolute top-4 right-4 flex gap-2">
          <LanguageToggle />
          <Button variant="ghost" size="sm" onClick={() => signOut()}><LogOut className="h-4 w-4 mr-1" />{t("logout")}</Button>
        </div>
        <div className="w-full max-w-sm">
          <PinKeypad
            error={pinErr}
            onSubmit={async (pin) => {
              await unlockAudio();
              const s = await verifyPin(pin);
              if (s) { setStaff(s); setPinErr(null); }
              else setPinErr(t("wrong_pin"));
            }}
          />
          <p className="text-xs text-center text-muted-foreground mt-4">
            Demo: 1234 (admin) · 9999 (manager) · 1111 (staff)
          </p>
        </div>
      </div>
    );
  }

  const navItems = [
    { to: "/dashboard", label: t("nav_dashboard"), icon: BarChart3 },
    { to: "/pos", label: t("nav_pos"), icon: LayoutGrid },
    { to: "/reports", label: t("nav_reports"), icon: FileText },
    { to: "/settings", label: t("nav_settings"), icon: Settings },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background" lang={lang}>
      <header className="h-14 border-b bg-card flex items-center px-4 gap-4 sticky top-0 z-30">
        <div className="font-semibold text-primary">🍽️ {t("app_name")}</div>
        <nav className="flex items-center gap-1 ml-4">
          {navItems.map((it) => {
            const active = path.startsWith(it.to);
            const showBadge = it.to === "/pos" && qrAlertCount > 0;
            return (
              <Link key={it.to} to={it.to}
                className={`relative flex items-center gap-2 px-3 py-1.5 rounded-md text-sm ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                <it.icon className="h-4 w-4" />{it.label}
                {showBadge && (
                  <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold animate-pulse">
                    {qrAlertCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LanguageToggle />
          <Button variant="outline" size="sm" onClick={() => setStaff(null)} className="gap-2">
            <UserCircle2 className="h-4 w-4" />
            <span className="font-medium">{staff.name}</span>
            <span className="text-xs text-muted-foreground">({staff.role})</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => signOut()} title={t("logout")}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
