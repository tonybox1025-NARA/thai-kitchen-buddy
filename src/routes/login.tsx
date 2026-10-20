import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";
import { toast } from "sonner";
import { KeyRound, RefreshCw, UserRound, UtensilsCrossed } from "lucide-react";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { loading, session, signIn, signInWithPin, accessStatus, refreshAccessStatus } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [pin, setPin] = useState("");
  const [statusChecked, setStatusChecked] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const nextPath =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("next") : null;
  const safeNextPath = nextPath === "/crew" ? "/crew" : "/pos";

  useEffect(() => {
    if (!loading && session) window.location.replace(safeNextPath);
  }, [loading, session, safeNextPath]);

  useEffect(() => {
    if (loading || accessStatus) {
      if (accessStatus) setStatusChecked(true);
      return;
    }
    void refreshAccessStatus().then((status) => {
      setStatusChecked(true);
      setStatusError(!status);
      if (status?.profiles.length === 1) setProfileId(status.profiles[0].id);
    });
  }, [loading, accessStatus, refreshAccessStatus]);

  if (loading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-background to-muted p-4 text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast.error(error);
  };

  const submitPin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profileId || pin.length !== 6) return;
    setBusy(true);
    const result = await signInWithPin(profileId, pin);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      setPin("");
      return;
    }
    window.location.replace(safeNextPath);
  };

  if (!statusChecked && !accessStatus) {
    return (
      <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-background to-muted p-4">
        <RefreshCw className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (accessStatus?.configured) {
    return (
      <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-background to-muted p-4">
        <div className="absolute top-4 right-4">
          <LanguageToggle />
        </div>
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center mb-2">
              <KeyRound className="h-7 w-7" />
            </div>
            <CardTitle className="text-2xl">Open LONMOH</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose your name and enter the store PIN
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitPin} className="space-y-5">
              <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                {accessStatus.profiles.map((profile) => (
                  <Button
                    key={profile.id}
                    type="button"
                    variant={profileId === profile.id ? "default" : "outline"}
                    className="h-12 justify-start"
                    onClick={() => setProfileId(profile.id)}
                  >
                    <UserRound className="mr-2 h-4 w-4" />
                    {profile.name}
                  </Button>
                ))}
              </div>
              <div>
                <Label htmlFor="shared-pin">PIN</Label>
                <Input
                  id="shared-pin"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={pin}
                  onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="h-14 text-center text-2xl tracking-[0.45em]"
                  placeholder="••••••"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={busy || !profileId || pin.length !== 6}
              >
                Open app
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-background to-muted p-4">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Connection needed</CardTitle>
            <p className="text-sm text-muted-foreground">
              The saved login is safe. Connect to the internet and try again.
            </p>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              onClick={() => {
                setStatusChecked(false);
                setStatusError(false);
                void refreshAccessStatus().then((status) => {
                  setStatusChecked(true);
                  setStatusError(!status);
                  if (status?.profiles.length === 1) setProfileId(status.profiles[0].id);
                });
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh grid place-items-center bg-gradient-to-br from-background to-muted p-4">
      <div className="absolute top-4 right-4">
        <LanguageToggle />
      </div>
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center mb-2">
            <UtensilsCrossed className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">{t("device_login")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="email">{t("email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                enterKeyHint="next"
              />
            </div>
            <div>
              <Label htmlFor="password">{t("password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {t("sign_in")}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Accounts are created by an administrator only.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
