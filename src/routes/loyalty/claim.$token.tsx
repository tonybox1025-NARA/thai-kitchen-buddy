import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Gift, Heart, Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/loyalty/claim/$token")({
  component: LoyaltyClaimPage,
  head: () => ({
    meta: [
      { title: "LONMOH Loyalty" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1" },
    ],
  }),
});

type ClaimInfo = {
  claim: {
    token: string;
    status: string;
    claim_points: number;
    total_amount: number;
    claimed_at: string | null;
    expires_at: string | null;
  };
  member: null | {
    id: string;
    full_name: string;
    current_points: number;
    member_group_en: string | null;
  };
};

function walletToken() {
  const key = "lonmoh_guest_wallet_token";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(key, token);
  return token;
}

function LoyaltyClaimPage() {
  const { token } = Route.useParams();
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/public/loyalty-claim/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      setError(data?.error ?? "Could not load this receipt.");
      return;
    }
    setInfo(data as ClaimInfo);
  };

  useEffect(() => { void load(); }, [token]);

  const claim = async () => {
    setClaiming(true);
    setError(null);
    const res = await fetch(`/api/public/loyalty-claim/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guest_token: walletToken() }),
    });
    const data = await res.json().catch(() => null);
    setClaiming(false);
    if (!res.ok) {
      setError(data?.error ?? "Could not collect points.");
      return;
    }
    setInfo(data as ClaimInfo);
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-amber-50 to-teal-50 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading loyalty receipt...
        </div>
      </div>
    );
  }

  const claimInfo = info?.claim;
  const member = info?.member;
  const claimed = claimInfo?.status === "claimed";

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-teal-50 p-4">
      <div className="mx-auto max-w-md pt-8 space-y-4">
        <div className="text-center">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow">
            <Heart className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-2xl font-black">LONMOH Loyalty</h1>
          <p className="text-sm text-muted-foreground">Collect points from your receipt.</p>
        </div>

        {error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Receipt points</span>
              {claimed ? <Badge className="gap-1"><Check className="h-3 w-3" />Claimed</Badge> : <Badge variant="secondary">Ready</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-2xl bg-amber-100 p-5 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Earn</div>
              <div className="mt-1 text-5xl font-black text-amber-700 tabular-nums">
                +{Number(claimInfo?.claim_points ?? 0).toLocaleString()}
              </div>
              <div className="text-sm text-amber-700">points</div>
            </div>

            {member && (
              <div className="rounded-xl border p-4">
                <div className="text-sm text-muted-foreground">Your wallet</div>
                <div className="mt-1 font-semibold">{member.full_name}</div>
                <div className="mt-2 flex items-end justify-between">
                  <span className="text-sm text-muted-foreground">Current points</span>
                  <span className="text-2xl font-black tabular-nums">{Number(member.current_points ?? 0).toLocaleString()}</span>
                </div>
              </div>
            )}

            {!claimed ? (
              <Button className="w-full h-12 text-base" onClick={claim} disabled={claiming}>
                {claiming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Gift className="h-4 w-4 mr-2" />}
                Collect my points
              </Button>
            ) : (
              <div className="rounded-xl bg-green-50 border border-green-200 p-4 text-center text-green-700">
                <Sparkles className="h-5 w-5 mx-auto mb-1" />
                Points saved to this phone.
              </div>
            )}

            <p className="text-center text-xs text-muted-foreground">
              No phone number required. This phone keeps your guest wallet. LINE connection can be added later to protect points across devices.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
