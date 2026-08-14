import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, pickName } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { thb } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeypadInput } from "@/components/KeypadInput";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Banknote, QrCode, CreditCard, Printer, RotateCcw, PencilLine, Eye, Tag, X, Percent, DollarSign, Gift, Scissors, Check, Heart, Search } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ManagerPinDialog } from "@/components/ManagerPinDialog";
import { printCounter } from "@/lib/counter-printer";
import { toast } from "sonner";

export const Route = createFileRoute("/_app/payment/$billId")({ component: PaymentPage });

type Bill = {
  id: string; order_id: string; subtotal: number; discount_amount: number;
  member_id: string | null;
  member_discount_amount: number; vat_mode: "inclusive" | "exclusive"; vat_rate: number;
  service_fee_rate: number; service_fee_amount: number; rounding_mode: RoundingMode; rounding_adjustment: number;
  vat_amount: number; total: number; status: string; paid_at: string | null;
};
type Item = { id: string; name_th: string; name_en: string; qty: number; unit_price: number; status: string };
type PaymentMethod = "qr" | "cash" | "card" | "gov_qr";
type Payment = { id: string; method: PaymentMethod; amount: number; cash_received: number | null; change_due: number | null; tip_amount: number; reference: string | null };
type MemberLookup = {
  id: string;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  current_points: number;
  member_group_en: string | null;
};

type BillDiscount = {
  id: string;
  bill_id: string;
  type: "percent" | "fixed" | "free_item";
  percent_value: number | null;
  fixed_value: number | null;
  free_item_id: string | null;
  free_item_name: string | null;
  amount: number;
  applied_by: string | null;
  applied_by_name: string | null;
  applied_at: string;
};

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 1];
type RoundingMode = "none" | "nearest_whole" | "up_whole" | "down_whole";

/** Compute VAT and final total from after-discount subtotal */
function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function applyRounding(value: number, mode: RoundingMode) {
  if (mode === "nearest_whole") return Math.round(value);
  if (mode === "up_whole") return Math.ceil(value);
  if (mode === "down_whole") return Math.floor(value);
  return roundMoney(value);
}

function computeTotals(
  afterDisc: number,
  vatEnabled: boolean,
  vatMode: "inclusive" | "exclusive",
  vatRate: number,
  serviceFeeRate: number,
  roundingMode: RoundingMode,
) {
  const serviceFeeAmount = roundMoney(afterDisc * (serviceFeeRate / 100));
  const taxableBase = afterDisc + serviceFeeAmount;
  let vatAmount = 0;
  let beforeRounding = taxableBase;

  if (vatEnabled) {
    const rate = vatRate / 100;
    if (vatMode === "exclusive") {
      vatAmount = roundMoney(taxableBase * rate);
      beforeRounding = taxableBase + vatAmount;
    } else {
      vatAmount = roundMoney(taxableBase - taxableBase / (1 + rate));
    }
  }

  const total = applyRounding(beforeRounding, roundingMode);
  const roundingAdjustment = roundMoney(total - beforeRounding);
  return { serviceFeeAmount, vatAmount, roundingAdjustment, total };
}

function makeClaimToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function PaymentPage() {
  const { billId } = Route.useParams();
  const { t, lang } = useI18n();
  const { staff } = useAuth();
  const nav = useNavigate();

  const [bill, setBill] = useState<Bill | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [appliedDiscount, setAppliedDiscount] = useState<BillDiscount | null>(null);
  const [memberDisc, setMemberDisc] = useState(0);
  const [pointsRedeemed, setPointsRedeemed] = useState(0);
  const [tableCode, setTableCode] = useState("");
  const [restName, setRestName] = useState("");
  const [settingsVatEnabled, setSettingsVatEnabled] = useState(true);
  const [settingsVatMode, setSettingsVatMode] = useState<"inclusive" | "exclusive">("inclusive");
  const [settingsServiceFeeRate, setSettingsServiceFeeRate] = useState(0);
  const [settingsRoundingMode, setSettingsRoundingMode] = useState<RoundingMode>("none");
  const [settingsMaxDiscountPercent, setSettingsMaxDiscountPercent] = useState(100);
  const [govQrEnabled, setGovQrEnabled] = useState(false);
  const [govQrLabel, setGovQrLabel] = useState("60/40");
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true);
  const [loyaltyPointsPerBaht, setLoyaltyPointsPerBaht] = useState(1);
  const [signupBonus, setSignupBonus] = useState(0);
  // New-member form (create at the register)
  const [newMemberMode, setNewMemberMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNick, setNewNick] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [creatingMember, setCreatingMember] = useState(false);
  const [receiptLogoUrl, setReceiptLogoUrl] = useState<string | null>(null);
  const [receiptAddress, setReceiptAddress] = useState<string | null>(null);
  const [receiptPromo, setReceiptPromo] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<MemberLookup | null>(null);
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberLookup[]>([]);

  // QR payment state
  const [qrAmt, setQrAmt] = useState(0);
  const [qrTip, setQrTip] = useState(0);
  const [govQrAmt, setGovQrAmt] = useState(0);
  const [cardAmt, setCardAmt] = useState(0);
  const [cardTip, setCardTip] = useState(0);

  // Cash dialog
  const [cashOpen, setCashOpen] = useState(false);
  const [cashCount, setCashCount] = useState<Record<number, number>>({});
  const [cashAmount, setCashAmount] = useState(0);

  // Refund
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundAmt, setRefundAmt] = useState(0);
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"refund" | "correction" | null>(null);

  // Customer-facing view
  const [customerViewOpen, setCustomerViewOpen] = useState(false);

  // Payment type correction
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrChanges, setCorrChanges] = useState<Record<string, PaymentMethod>>({});
  const [corrReason, setCorrReason] = useState("");

  // Split bill
  const [splitOpen, setSplitOpen] = useState(false);

  // Discount dialog
  const [discDlgOpen, setDiscDlgOpen] = useState(false);
  const [discDlgTab, setDiscDlgTab] = useState<"percent" | "fixed" | "free_item">("percent");
  const [discPctInput, setDiscPctInput] = useState(0);
  const [discFixedInput, setDiscFixedInput] = useState(0);
  const [discFreeItemId, setDiscFreeItemId] = useState<string>("");

  const load = async () => {
    const [{ data: b }, { data: ps }, { data: s }] = await Promise.all([
      supabase.from("bills").select("*").eq("id", billId).single(),
      supabase.from("payments").select("*").eq("bill_id", billId),
      supabase.from("settings").select("restaurant_name, address, receipt_promo, receipt_logo_url, vat_enabled, vat_mode, vat_rate, service_fee_rate, rounding_mode, max_discount_percent, loyalty_enabled, loyalty_points_per_baht, loyalty_signup_bonus, gov_qr_enabled, gov_qr_label, gov_qr_customer_percent, gov_qr_government_percent").eq("id", 1).single(),
    ]);
    if (b) {
      setBill(b as unknown as Bill);
      setMemberDisc(Number(b.member_discount_amount));
      setPointsRedeemed(Math.max(0, Math.floor(Number((b as any).points_redeemed ?? 0))));
      if ((b as any).member_id) {
        const { data: memberRow } = await supabase
          .from("members")
          .select("id,full_name,nickname,phone,current_points,member_group_en")
          .eq("id", (b as any).member_id)
          .maybeSingle();
        setSelectedMember((memberRow as MemberLookup | null) ?? null);
      } else {
        setSelectedMember(null);
      }

      const { data: it } = await supabase.from("order_items").select("*").eq("order_id", b.order_id).neq("status", "voided");
      if (it) setItems(it as Item[]);

      const { data: ord } = await supabase.from("orders").select("table_id").eq("id", b.order_id).single();
      if (ord?.table_id) {
        const { data: tbl } = await supabase.from("restaurant_tables").select("code").eq("id", ord.table_id).single();
        if (tbl) setTableCode(tbl.code);
      }

      // Load applied discount (at most one per bill)
      const { data: discRows } = await (supabase as any)
        .from("bill_discounts")
        .select("*")
        .eq("bill_id", b.id)
        .order("applied_at", { ascending: false })
        .limit(1);

      const discRow = (discRows as any[])?.[0] ?? null;
      if (discRow) {
        let staffName: string | null = null;
        if (discRow.applied_by) {
          const { data: applier } = await supabase.from("staff").select("name").eq("id", discRow.applied_by).maybeSingle();
          staffName = applier?.name ?? null;
        }
        setAppliedDiscount({ ...discRow, applied_by_name: staffName });
      } else {
        setAppliedDiscount(null);
      }
    }
    if (ps) setPayments(ps as Payment[]);
    if (s) {
      const row = s as any;
      setRestName(row.restaurant_name);
      setReceiptLogoUrl(row.receipt_logo_url ?? null);
      setReceiptAddress(row.address ?? null);
      setReceiptPromo(row.receipt_promo ?? null);
      setSettingsVatEnabled(row.vat_enabled ?? true);
      setSettingsVatMode((row.vat_mode as "inclusive" | "exclusive") || "inclusive");
      setSettingsServiceFeeRate(Number(row.service_fee_rate ?? 0));
      setSettingsRoundingMode((row.rounding_mode as RoundingMode) || "none");
      setSettingsMaxDiscountPercent(Number(row.max_discount_percent ?? 100));
      setLoyaltyEnabled(row.loyalty_enabled ?? true);
      setLoyaltyPointsPerBaht(Number(row.loyalty_points_per_baht ?? 1));
      setSignupBonus(Math.max(0, Math.floor(Number((row as any).loyalty_signup_bonus ?? 0))));
      setGovQrEnabled(row.gov_qr_enabled ?? false);
      setGovQrLabel(row.gov_qr_label ?? "60/40");
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [billId]);

  // ── Derived totals ──────────────────────────────────────────────────────────
  const subtotal = items.reduce((s, i) => s + i.qty * Number(i.unit_price), 0);
  const totalDisc = appliedDiscount?.amount ?? 0;
  // Redeemed loyalty points act as a discount: 1 point = 1 THB off.
  const pointsDiscount = pointsRedeemed;
  // Can't spend more points than the member has, nor more than the pre-points bill.
  const maxRedeem = selectedMember
    ? Math.min(Math.floor(Number(selectedMember.current_points ?? 0)), Math.max(0, Math.floor(subtotal - totalDisc - memberDisc)))
    : 0;
  const afterDisc = Math.max(0, subtotal - totalDisc - memberDisc - pointsDiscount);
  const { serviceFeeAmount, vatAmount, roundingAdjustment, total } = bill
    ? computeTotals(
      afterDisc,
      settingsVatEnabled,
      settingsVatMode,
      Number(bill.vat_rate),
      settingsServiceFeeRate,
      settingsRoundingMode,
    )
    : { serviceFeeAmount: 0, vatAmount: 0, roundingAdjustment: 0, total: afterDisc };

  const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, total - paid);
  const earnPoints = loyaltyEnabled && selectedMember ? Math.max(0, Math.floor(total * loyaltyPointsPerBaht)) : 0;
  const paymentMethodLabel = (method: PaymentMethod) => (
    method === "cash" ? t("cash")
    : method === "qr" ? t("qr_transfer")
    : method === "gov_qr" ? govQrLabel
    : t("card")
  );

  // Persist member discount + VAT + total to bill (discount_amount owned by applyDiscount/removeDiscount)
  const persistBill = async () => {
    if (!bill) return;
    await (supabase as any).from("bills").update({
      subtotal,
      member_discount_amount: memberDisc,
      points_redeemed: pointsRedeemed,
      service_fee_rate: settingsServiceFeeRate,
      service_fee_amount: serviceFeeAmount,
      rounding_mode: settingsRoundingMode,
      rounding_adjustment: roundingAdjustment,
      vat_amount: vatAmount,
      total,
    }).eq("id", bill.id);
  };

  useEffect(() => { persistBill(); /* eslint-disable-next-line */ }, [memberDisc, pointsRedeemed, bill?.id, subtotal, settingsVatEnabled, settingsVatMode, settingsServiceFeeRate, settingsRoundingMode]);

  // Sync QR field with remaining balance
  useEffect(() => { setQrAmt(remaining); }, [remaining]);
  // Default the amount fields to the full remaining, but the cashier can change
  // each one to a partial amount (e.g. split across methods, or several guests
  // using 60/40). Amounts are NOT capped to the balance — a tip can be added on
  // top via QR or card.
  useEffect(() => { setGovQrAmt(remaining); }, [remaining]);
  useEffect(() => { setCardAmt(remaining); }, [remaining]);

  // ── Discount helpers ────────────────────────────────────────────────────────

  // Live preview amount for the dialog
  const discPreviewAmt = (() => {
    const maxDiscountAmount = roundMoney(subtotal * (settingsMaxDiscountPercent / 100));
    if (discDlgTab === "percent") return Math.min(roundMoney((subtotal * discPctInput) / 100), maxDiscountAmount);
    if (discDlgTab === "fixed") return Math.min(discFixedInput, subtotal, maxDiscountAmount);
    const fi = items.find((i) => i.id === discFreeItemId);
    return fi ? Math.min(fi.qty * Number(fi.unit_price), maxDiscountAmount) : 0;
  })();
  const discPreviewTotal = bill
    ? computeTotals(
      Math.max(0, subtotal - discPreviewAmt - memberDisc - pointsDiscount),
      settingsVatEnabled,
      settingsVatMode,
      Number(bill.vat_rate),
      settingsServiceFeeRate,
      settingsRoundingMode,
    ).total
    : Math.max(0, subtotal - discPreviewAmt - memberDisc - pointsDiscount);

  const applyDiscount = async () => {
    if (!bill || !staff) return;
    let amount = 0;
    const extras: Record<string, unknown> = {};

    if (discDlgTab === "percent") {
      if (discPctInput <= 0 || discPctInput > settingsMaxDiscountPercent) {
        toast.error(lang === "th" ? `ส่วนลดสูงสุด ${settingsMaxDiscountPercent}%` : `Maximum discount is ${settingsMaxDiscountPercent}%`);
        return;
      }
      amount = roundMoney((subtotal * discPctInput) / 100);
      extras.percent_value = discPctInput;
    } else if (discDlgTab === "fixed") {
      if (discFixedInput <= 0) { toast.error(lang === "th" ? "ใส่จำนวนเงิน" : "Enter an amount"); return; }
      amount = Math.min(discFixedInput, subtotal, roundMoney(subtotal * (settingsMaxDiscountPercent / 100)));
      extras.fixed_value = discFixedInput;
    } else {
      const fi = items.find((i) => i.id === discFreeItemId);
      if (!fi) { toast.error(lang === "th" ? "เลือกรายการ" : "Select an item"); return; }
      amount = fi.qty * Number(fi.unit_price);
      extras.free_item_id = fi.id;
      extras.free_item_name = lang === "th" ? fi.name_th : fi.name_en;
    }
    const maxDiscountAmount = roundMoney(subtotal * (settingsMaxDiscountPercent / 100));
    if (amount > maxDiscountAmount) {
      toast.error(lang === "th" ? `ส่วนลดสูงสุด ${settingsMaxDiscountPercent}%` : `Maximum discount is ${settingsMaxDiscountPercent}%`);
      return;
    }

    // Delete any existing discount for this bill, then insert new one
    await (supabase as any).from("bill_discounts").delete().eq("bill_id", bill.id);
    await (supabase as any).from("bill_discounts").insert({
      bill_id: bill.id,
      type: discDlgTab,
      amount,
      applied_by: staff.id,
      ...extras,
    });

    // Recompute totals with new discount and persist to bill
    const newAfterDisc = Math.max(0, subtotal - amount - memberDisc - pointsDiscount);
    const { serviceFeeAmount: newService, vatAmount: newVat, roundingAdjustment: newRounding, total: newTotal } = computeTotals(
      newAfterDisc,
      settingsVatEnabled,
      settingsVatMode,
      Number(bill.vat_rate),
      settingsServiceFeeRate,
      settingsRoundingMode,
    );
    await (supabase as any).from("bills").update({
      discount_amount: amount,
      service_fee_rate: settingsServiceFeeRate,
      service_fee_amount: newService,
      rounding_mode: settingsRoundingMode,
      rounding_adjustment: newRounding,
      vat_amount: newVat,
      total: newTotal,
    }).eq("id", bill.id);

    await load();
    setDiscDlgOpen(false);
    toast.success(lang === "th" ? "ใส่ส่วนลดแล้ว" : "Discount applied");
  };

  const removeDiscount = async () => {
    if (!bill) return;
    await (supabase as any).from("bill_discounts").delete().eq("bill_id", bill.id);
    const newAfterDisc = Math.max(0, subtotal - memberDisc - pointsDiscount);
    const { serviceFeeAmount: newService, vatAmount: newVat, roundingAdjustment: newRounding, total: newTotal } = computeTotals(
      newAfterDisc,
      settingsVatEnabled,
      settingsVatMode,
      Number(bill.vat_rate),
      settingsServiceFeeRate,
      settingsRoundingMode,
    );
    await (supabase as any).from("bills").update({
      discount_amount: 0,
      service_fee_rate: settingsServiceFeeRate,
      service_fee_amount: newService,
      rounding_mode: settingsRoundingMode,
      rounding_adjustment: newRounding,
      vat_amount: newVat,
      total: newTotal,
    }).eq("id", bill.id);
    await load();
    toast.success(lang === "th" ? "ยกเลิกส่วนลดแล้ว" : "Discount removed");
  };

  const openDiscountDialog = () => {
    // Pre-fill inputs from existing discount if any
    if (appliedDiscount) {
      setDiscDlgTab(appliedDiscount.type);
      setDiscPctInput(appliedDiscount.percent_value ?? 0);
      setDiscFixedInput(appliedDiscount.fixed_value ?? 0);
      setDiscFreeItemId(appliedDiscount.free_item_id ?? "");
    } else {
      setDiscDlgTab("percent");
      setDiscPctInput(0);
      setDiscFixedInput(0);
      setDiscFreeItemId("");
    }
    setDiscDlgOpen(true);
  };

  // ── Discount label helpers ──────────────────────────────────────────────────
  const discTypeLabel = (d: BillDiscount) => {
    if (d.type === "percent") return `${d.percent_value ?? ""}%`;
    if (d.type === "fixed")   return thb(d.fixed_value ?? 0);
    return d.free_item_name ?? (lang === "th" ? "แถมฟรี" : "Free item");
  };

  // ── Payment helpers ─────────────────────────────────────────────────────────
  const addPayment = async (method: Payment["method"], amount: number, extras: Record<string, unknown> = {}) => {
    if (!bill || amount <= 0) return;
    await supabase.from("payments").insert({ bill_id: bill.id, method, amount, ...extras });
    await load();
    if (paid + amount + 0.001 >= total) await finalize();
  };

  const completeZeroTotal = async () => {
    if (!bill || total > 0.001 || paidStatus) return;
    await finalize();
  };

  const searchMembers = async () => {
    const term = memberQuery.trim().replace(/[%,()]/g, "");
    let query = supabase
      .from("members")
      .select("id,full_name,nickname,phone,current_points,member_group_en")
      .order("current_points", { ascending: false })
      .limit(50);
    if (term) {
      query = query.or(`full_name.ilike.%${term}%,nickname.ilike.%${term}%,phone.ilike.%${term}%`);
    }
    const { data, error } = await query;
    if (error) { toast.error(error.message); return; }
    setMemberResults((data ?? []) as MemberLookup[]);
  };

  const selectMember = async (member: MemberLookup) => {
    if (!bill) return;
    const { error } = await supabase.from("bills").update({ member_id: member.id }).eq("id", bill.id);
    if (error) { toast.error(error.message); return; }
    setSelectedMember(member);
    setPointsRedeemed(0);
    setMemberSearchOpen(false);
    toast.success(t("pay_member_selected"));
  };

  const clearMember = async () => {
    if (!bill) return;
    const { error } = await supabase.from("bills").update({ member_id: null }).eq("id", bill.id);
    if (error) { toast.error(error.message); return; }
    setSelectedMember(null);
    setPointsRedeemed(0);
  };

  const resetNewMember = () => {
    setNewMemberMode(false); setNewName(""); setNewNick(""); setNewPhone("");
  };

  // Create a member at the register (walk-in onboarding) and attach to this bill.
  const createMember = async () => {
    if (!bill) return;
    const fullName = newName.trim() || newNick.trim();
    const phone = newPhone.trim().replace(/[^\d+]/g, "") || null;
    if (!fullName) { toast.error(t("pay_name_required")); return; }
    setCreatingMember(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .insert({
          full_name: fullName,
          nickname: newNick.trim() || null,
          phone,
          opening_points: signupBonus,
          current_points: signupBonus,
          imported_from: "pos",
        })
        .select("id,full_name,nickname,phone,current_points,member_group_en")
        .single();
      if (error) throw error;
      if (signupBonus > 0) {
        await supabase.from("member_point_ledger").insert({
          member_id: data.id, type: "signup_bonus", points: signupBonus,
          balance_after: signupBonus, description: "Signup bonus (registered at POS)",
        });
      }
      resetNewMember();
      await selectMember(data as MemberLookup);
      toast.success(signupBonus > 0 ? `Member created · +${signupBonus} pts` : "Member created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create member");
    } finally {
      setCreatingMember(false);
    }
  };

  // Deduct redeemed points from the member and log it. Mirrors awardLoyaltyPoints:
  // idempotent per bill (won't double-deduct if finalize runs twice).
  const redeemLoyaltyPoints = async () => {
    if (!bill || !selectedMember || pointsRedeemed <= 0) return;
    const { data: existing } = await supabase
      .from("member_point_ledger")
      .select("id")
      .eq("bill_id", bill.id)
      .eq("type", "redeem")
      .maybeSingle();
    if (existing) return;

    const { data: freshMember, error: memberErr } = await supabase
      .from("members").select("current_points").eq("id", selectedMember.id).single();
    if (memberErr || !freshMember) { toast.error(memberErr?.message ?? "Could not load member points"); return; }

    const current = Number((freshMember as any).current_points ?? 0);
    const use = Math.min(pointsRedeemed, current); // never go negative
    if (use <= 0) return;
    const balanceAfter = current - use;

    const { error: updateErr } = await supabase
      .from("members").update({ current_points: balanceAfter, updated_at: new Date().toISOString() }).eq("id", selectedMember.id);
    if (updateErr) { toast.error(updateErr.message); return; }

    const { error: ledgerErr } = await supabase.from("member_point_ledger").insert({
      member_id: selectedMember.id,
      bill_id: bill.id,
      type: "redeem",
      points: -use,
      balance_after: balanceAfter,
      description: `Redeemed on bill ${bill.id}`,
    });
    if (ledgerErr) { toast.error(ledgerErr.message); return; }
    setSelectedMember({ ...selectedMember, current_points: balanceAfter });
  };

  const awardLoyaltyPoints = async () => {
    if (!bill || !selectedMember || !loyaltyEnabled || earnPoints <= 0) return;
    const { data: existing } = await supabase
      .from("member_point_ledger")
      .select("id")
      .eq("bill_id", bill.id)
      .eq("type", "earn")
      .maybeSingle();
    if (existing) return;

    const { data: freshMember, error: memberErr } = await supabase
      .from("members")
      .select("current_points")
      .eq("id", selectedMember.id)
      .single();
    if (memberErr || !freshMember) {
      toast.error(memberErr?.message ?? "Could not load member points");
      return;
    }

    const balanceAfter = Number((freshMember as any).current_points ?? 0) + earnPoints;
    const { error: updateErr } = await supabase
      .from("members")
      .update({ current_points: balanceAfter, updated_at: new Date().toISOString() })
      .eq("id", selectedMember.id);
    if (updateErr) { toast.error(updateErr.message); return; }

    const { error: ledgerErr } = await supabase.from("member_point_ledger").insert({
      member_id: selectedMember.id,
      bill_id: bill.id,
      type: "earn",
      points: earnPoints,
      balance_after: balanceAfter,
      description: `Earned from bill ${bill.id}`,
    });
    if (ledgerErr) { toast.error(ledgerErr.message); return; }
    setSelectedMember({ ...selectedMember, current_points: balanceAfter });
  };

  const ensureLoyaltyClaim = async () => {
    if (!bill || !loyaltyEnabled) return null;

    const { data: existing } = await supabase
      .from("loyalty_claim_tokens")
      .select("token,claim_points,status")
      .eq("bill_id", bill.id)
      .maybeSingle();
    if (existing) {
      return {
        token: existing.token,
        url: `${window.location.origin}/loyalty/claim/${existing.token}`,
        points: Number(existing.claim_points ?? 0),
      };
    }

    const token = makeClaimToken();
    const points = Math.max(0, Math.floor(total * loyaltyPointsPerBaht));
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
    const { error } = await supabase.from("loyalty_claim_tokens").insert({
      token,
      bill_id: bill.id,
      member_id: selectedMember?.id ?? null,
      status: selectedMember ? "claimed" : "open",
      claim_points: points,
      total_amount: total,
      claimed_at: selectedMember ? new Date().toISOString() : null,
      expires_at: expiresAt,
    });
    if (error) {
      toast.error(error.message);
      return null;
    }
    return { token, url: `${window.location.origin}/loyalty/claim/${token}`, points };
  };

  const finalize = async () => {
    if (!bill) return;
    await supabase.from("bills").update({ status: "paid", paid_at: new Date().toISOString(), cashier_id: staff?.id }).eq("id", bill.id);
    await supabase.from("orders").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", bill.order_id);
    const { data: ord } = await supabase.from("orders").select("table_id").eq("id", bill.order_id).single();
    if (ord?.table_id) {
      await supabase.from("restaurant_tables").update({ status: "available", guests: 0, has_qr_alert: false }).eq("id", ord.table_id);
    }
    await redeemLoyaltyPoints();
    await awardLoyaltyPoints();
    const loyaltyClaim = await ensureLoyaltyClaim();
    await printCounter({
      kind: "receipt", bill_id: bill.id, restaurant: restName, table: tableCode,
      logoUrl: receiptLogoUrl || undefined,
      address: receiptAddress || undefined,
      promo: receiptPromo || undefined,
      items, total, vatAmount: settingsVatEnabled && settingsVatMode === "exclusive" ? vatAmount : 0,
      vat_mode: settingsVatMode, payments: [...payments], language: lang,
      discountAmount: appliedDiscount?.amount ?? 0,
      memberDiscountAmount: memberDisc,
      pointsDiscountAmount: pointsDiscount,
      serviceFeeAmount,
      roundingAdjustment,
      discount: appliedDiscount ? { type: appliedDiscount.type, label: discTypeLabel(appliedDiscount), amount: appliedDiscount.amount } : null,
      loyaltyClaimUrl: loyaltyClaim?.url,
      loyaltyClaimCode: loyaltyClaim?.token,
      loyaltyEarnPoints: loyaltyClaim?.points,
    });
    toast.success(t("paid"));
    await load();
  };

  const openCash = () => { setCashCount({}); setCashAmount(remaining); setCashOpen(true); };
  // Tap a denomination to add one; the "−" badge removes one (fixes an over-tap).
  const addDenom = (d: number, delta: number) =>
    setCashCount((prev) => ({ ...prev, [d]: Math.max(0, (prev[d] ?? 0) + delta) }));
  const cashTotal = Object.entries(cashCount).reduce((s, [d, c]) => s + Number(d) * (c || 0), 0);
  const change = Math.max(0, cashTotal - cashAmount);
  const submitCash = async () => {
    if (cashTotal < cashAmount) { toast.error(t("pay_not_enough_cash")); return; }
    await addPayment("cash", cashAmount, { cash_received: cashTotal, change_due: change, cash_breakdown: cashCount });
    setCashOpen(false);
  };

  const performRefund = () => {
    if (!refundReason.trim() || refundAmt <= 0) return;
    if (staff?.role === "staff") { setPendingAction("refund"); setManagerOpen(true); return; }
    doRefund();
  };
  const doRefund = async () => {
    if (!bill) return;
    await supabase.from("refunds").insert({ bill_id: bill.id, amount: refundAmt, reason: refundReason, refunded_by: staff?.id });
    await supabase.from("bills").update({ status: "partial_refund" }).eq("id", bill.id);
    setRefundOpen(false); setRefundAmt(0); setRefundReason("");
    toast.success(t("pay_refunded"));
  };

  const paidStatus = bill?.status === "paid" || bill?.status === "partial_refund";
  const canCorrect = !!paidStatus && (staff?.role === "admin" || staff?.role === "manager");
  const openCorr = () => {
    if (staff?.role === "manager") { setPendingAction("correction"); setManagerOpen(true); return; }
    setCorrChanges({}); setCorrReason(""); setCorrOpen(true);
  };
  const applyCorrection = async () => {
    if (!bill || !staff) return;
    const changed = payments.filter((p) => corrChanges[p.id] && corrChanges[p.id] !== p.method);
    if (!changed.length) { setCorrOpen(false); return; }
    for (const p of changed) {
      await supabase.from("payments").update({ method: corrChanges[p.id] }).eq("id", p.id);
      await (supabase as any).from("payment_corrections").insert({
        payment_id: p.id, bill_id: bill.id,
        corrected_by: staff.id, old_method: p.method, new_method: corrChanges[p.id],
        reason: corrReason || null,
      });
    }
    setCorrOpen(false); setCorrReason(""); setCorrChanges({});
    await load();
    toast.success(`${changed.length} payment${changed.length > 1 ? "s" : ""} corrected`);
  };

  if (!bill) return <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] h-[calc(100vh-3.5rem)]">
      {/* ── Left: receipt preview ─────────────────────────────────────────── */}
      <div className="overflow-auto p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/pos"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" />{t("back")}</Button></Link>
          <h1 className="text-2xl font-bold">{t("payment")} — {tableCode}</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-center">{restName || "Restaurant"}</CardTitle>
            <p className="text-center text-xs text-muted-foreground">{t("table")} {tableCode} · {new Date().toLocaleString(lang === "th" ? "th-TH" : "en-US")}</p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className={`border-b last:border-0 ${appliedDiscount?.type === "free_item" && appliedDiscount.free_item_id === i.id ? "text-green-600 dark:text-green-400" : ""}`}>
                    <td className="py-1.5">{pickName(i, lang)}
                      {appliedDiscount?.type === "free_item" && appliedDiscount.free_item_id === i.id && (
                        <span className="ml-1.5 text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full font-medium">{t("free")}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right w-12">{i.qty}</td>
                    <td className="py-1.5 text-right w-24 tabular-nums">{thb(i.qty * Number(i.unit_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 space-y-1 text-sm">
              <Row label={t("subtotal")} value={thb(subtotal)} />

              {/* Applied discount row */}
              {appliedDiscount && (
                <div className="flex items-center justify-between text-green-700 dark:text-green-400">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Tag className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">
                      {appliedDiscount.type === "percent" && `${t("disc_pct")} (${appliedDiscount.percent_value}%)`}
                      {appliedDiscount.type === "fixed"   && `${t("disc_fixed")} (${thb(appliedDiscount.fixed_value ?? 0)})`}
                      {appliedDiscount.type === "free_item" && `${t("disc_free_item")}: ${appliedDiscount.free_item_name ?? ""}`}
                    </span>
                    {appliedDiscount.applied_by_name && (
                      <span className="text-xs text-muted-foreground shrink-0 ml-1">· {appliedDiscount.applied_by_name}</span>
                    )}
                  </div>
                  <span className="shrink-0 font-medium tabular-nums">- {thb(appliedDiscount.amount)}</span>
                </div>
              )}

              {memberDisc > 0 && <Row label={t("member_discount")} value={`- ${thb(memberDisc)}`} />}
              {pointsDiscount > 0 && <Row label={`${t("pay_points_used")} (${pointsRedeemed.toLocaleString()})`} value={`- ${thb(pointsDiscount)}`} />}
              {serviceFeeAmount > 0 && <Row label={`Service ${settingsServiceFeeRate}%`} value={thb(serviceFeeAmount)} />}
              {settingsVatEnabled && settingsVatMode === "exclusive" && <Row label={`${t("vat")} ${bill.vat_rate}%`} value={thb(vatAmount)} />}
              {roundingAdjustment !== 0 && <Row label="Rounding" value={`${roundingAdjustment > 0 ? "+" : ""}${thb(roundingAdjustment)}`} />}
              <div className="border-t pt-2 mt-2 flex justify-between text-lg font-bold">
                <span>{t("total")}</span><span className="tabular-nums">{thb(total)}</span>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full mt-3 text-muted-foreground" onClick={() => setCustomerViewOpen(true)}>
              <Eye className="h-3.5 w-3.5 mr-1.5" />Show to Customer
            </Button>
          </CardContent>
        </Card>

        {payments.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">{t("pay_payments")}</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {payments.map((p) => (
                <div key={p.id}>
                  <Row label={`${paymentMethodLabel(p.method)}${p.cash_received ? ` (rcv ${thb(p.cash_received)}, chg ${thb(p.change_due ?? 0)})` : ""}`} value={thb(p.amount)} />
                  {p.tip_amount > 0 && <Row label="  ↳ Tip (cash payout)" value={thb(p.tip_amount)} muted />}
                </div>
              ))}
              <Row label="Paid" value={thb(paid)} />
              <Row label="Remaining" value={thb(remaining)} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Right: actions ────────────────────────────────────────────────── */}
      <aside className="border-l bg-card p-4 overflow-auto">
        {!paidStatus ? (
          <>
            {/* ── Discount section ── */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">{t("discount")}</h3>
              </div>

              {appliedDiscount ? (
                /* Applied discount badge */
                <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 px-3 py-2">
                  <Tag className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-400 truncate">
                      - {thb(appliedDiscount.amount)} · {discTypeLabel(appliedDiscount)}
                    </p>
                    {appliedDiscount.applied_by_name && (
                      <p className="text-xs text-muted-foreground">{t("disc_applied_by")}: {appliedDiscount.applied_by_name}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={openDiscountDialog}>
                      {t("change_discount")}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={removeDiscount}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="w-full border-dashed" onClick={openDiscountDialog}>
                  <Tag className="h-4 w-4 mr-2" />{t("apply_discount")}
                </Button>
              )}
            </div>

            {/* Member discount */}
            <div className="mb-4 space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Heart className="h-4 w-4 text-primary" />Member
                </div>
                {selectedMember ? (
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={clearMember}>{t("clear")}</Button>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => { setMemberSearchOpen(true); void searchMembers(); }}>
                    Find
                  </Button>
                )}
              </div>
              {selectedMember ? (
                <div className="rounded-md bg-muted/60 p-2 text-sm">
                  <div className="font-semibold">{selectedMember.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {selectedMember.phone ?? "No phone"} · {Number(selectedMember.current_points ?? 0).toLocaleString()} pts
                    {selectedMember.member_group_en ? ` · ${selectedMember.member_group_en}` : ""}
                  </div>
                  {earnPoints > 0 && (
                    <div className="mt-1 text-xs font-medium text-primary">
                      Earn after payment: +{earnPoints.toLocaleString()} points
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Select a member to earn points on this bill.</p>
              )}
              <div>
                <Label className="text-xs">{t("member_discount")}</Label>
                <KeypadInput value={memberDisc} onChange={setMemberDisc} title={t("member_discount")} placeholder="0" />
              </div>
              {selectedMember && Number(selectedMember.current_points ?? 0) > 0 && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">
                      {t("pay_use_points")} <span className="text-muted-foreground">({Number(selectedMember.current_points ?? 0).toLocaleString()} {t("loy_pts")})</span>
                    </Label>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setPointsRedeemed(maxRedeem)} disabled={maxRedeem <= 0}>
                      {t("pay_points_max")}
                    </Button>
                  </div>
                  <KeypadInput
                    value={pointsRedeemed}
                    onChange={(n) => setPointsRedeemed(Math.max(0, Math.min(maxRedeem, Math.floor(n))))}
                    title={t("pay_use_points")}
                    placeholder="0"
                  />
                  {pointsRedeemed > 0 && <p className="mt-1 text-xs font-medium text-primary">−{thb(pointsDiscount)}</p>}
                </div>
              )}
            </div>

            {/* Split Bill */}
            <Button
              variant="outline"
              className="w-full mb-4 border-dashed gap-2 text-sm"
              onClick={() => setSplitOpen(true)}
              disabled={remaining <= 0}
            >
              <Scissors className="h-4 w-4" />{t("split_bill")}
            </Button>

            {/* ── Payment methods ── */}
            <h3 className="font-semibold mb-2 text-sm">{t("pay")}</h3>
            {remaining <= 0 ? (
              <Button className="w-full" size="lg" onClick={completeZeroTotal}>
                Complete checkout · {thb(0)}
              </Button>
            ) : (
            <Tabs defaultValue="cash">
              <TabsList className={`grid ${govQrEnabled ? "grid-cols-4" : "grid-cols-3"} w-full`}>
                <TabsTrigger value="cash"><Banknote className="h-4 w-4 mr-1" />{t("cash")}</TabsTrigger>
                <TabsTrigger value="qr"><QrCode className="h-4 w-4 mr-1" />QR</TabsTrigger>
                {govQrEnabled && <TabsTrigger value="gov_qr"><QrCode className="h-4 w-4 mr-1" />{govQrLabel}</TabsTrigger>}
                <TabsTrigger value="card"><CreditCard className="h-4 w-4 mr-1" />{t("card")}</TabsTrigger>
              </TabsList>
              <TabsContent value="cash" className="pt-3">
                <Button className="w-full" size="lg" onClick={openCash} disabled={remaining <= 0}>
                  {t("cash")} · {thb(remaining)}
                </Button>
              </TabsContent>
              <TabsContent value="qr" className="pt-3 space-y-2">
                <div>
                  <Label className="text-xs">{t("amount")}</Label>
                  <KeypadInput value={qrAmt} onChange={setQrAmt} title={t("amount")} />
                </div>
                <div className="text-sm flex justify-between bg-muted rounded px-2 py-1.5">
                  <span>{t("pay_balance_remaining")}</span>
                  <span className="font-semibold">{thb(Math.max(0, remaining - qrAmt))}</span>
                </div>
                <div>
                  <Label className="text-xs">{t("pay_tip_optional")}</Label>
                  <KeypadInput value={qrTip} onChange={setQrTip} title={t("pay_tip")} placeholder="0" />
                  <p className="text-xs text-muted-foreground mt-0.5">Tips collected via QR are paid out to staff in cash.</p>
                </div>
                {qrTip > 0 && (
                  <div className="text-sm flex justify-between bg-muted rounded px-2 py-1.5">
                    <span>Total QR charge</span>
                    <span className="font-semibold">{thb(qrAmt + qrTip)}</span>
                  </div>
                )}
                <Button className="w-full" size="lg" disabled={remaining <= 0 || qrAmt <= 0}
                  onClick={() => { addPayment("qr", qrAmt, { tip_amount: qrTip }); setQrTip(0); }}>
                  {t("qr_transfer")}{qrTip > 0 ? ` + Tip ${thb(qrTip)}` : ""}
                </Button>
              </TabsContent>
              {govQrEnabled && (
                <TabsContent value="gov_qr" className="pt-3 space-y-2">
                  <div>
                    <Label className="text-xs">{govQrLabel} {t("amount")}</Label>
                    <KeypadInput value={govQrAmt} onChange={setGovQrAmt} title={`${govQrLabel} ${t("amount")}`} />
                  </div>
                  <div className="text-sm flex justify-between bg-muted rounded px-2 py-1.5">
                    <span>{t("pay_balance_remaining")}</span>
                    <span className="font-semibold">{thb(Math.max(0, remaining - govQrAmt))}</span>
                  </div>
                  <Button className="w-full" size="lg" disabled={remaining <= 0 || govQrAmt <= 0}
                    onClick={() => addPayment("gov_qr", govQrAmt, { reference: govQrLabel })}>
                    {govQrLabel} · {thb(govQrAmt)}
                  </Button>
                  {remaining - govQrAmt > 0 && (
                    <p className="text-xs text-muted-foreground">Pay the balance of {thb(remaining - govQrAmt)} with cash or card next.</p>
                  )}
                </TabsContent>
              )}
              <TabsContent value="card" className="pt-3 space-y-2">
                <div>
                  <Label className="text-xs">{t("amount")}</Label>
                  <KeypadInput value={cardAmt} onChange={setCardAmt} title={t("amount")} />
                </div>
                <div className="text-sm flex justify-between bg-muted rounded px-2 py-1.5">
                  <span>{t("pay_balance_remaining")}</span>
                  <span className="font-semibold">{thb(Math.max(0, remaining - cardAmt))}</span>
                </div>
                <div>
                  <Label className="text-xs">{t("pay_tip_optional")}</Label>
                  <KeypadInput value={cardTip} onChange={setCardTip} title={t("pay_tip")} placeholder="0" />
                  <p className="text-xs text-muted-foreground mt-0.5">Tips collected via card are paid out to staff in cash.</p>
                </div>
                {cardTip > 0 && (
                  <div className="text-sm flex justify-between bg-muted rounded px-2 py-1.5">
                    <span>{t("pay_total_card")}</span>
                    <span className="font-semibold">{thb(cardAmt + cardTip)}</span>
                  </div>
                )}
                <Button className="w-full" size="lg" disabled={remaining <= 0 || cardAmt <= 0}
                  onClick={() => { addPayment("card", cardAmt, { tip_amount: cardTip }); setCardTip(0); }}>
                  {t("card")} · {thb(cardAmt)}{cardTip > 0 ? ` + Tip ${thb(cardTip)}` : ""}
                </Button>
              </TabsContent>
            </Tabs>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div className="text-center py-4">
              <div className="text-3xl">✅</div>
              <div className="text-xl font-bold mt-2">{t("paid")}</div>
              {appliedDiscount && (
                <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                  <Tag className="h-3.5 w-3.5 inline mr-1" />
                  {lang === "th" ? "ส่วนลด" : "Discount"} {discTypeLabel(appliedDiscount)} — - {thb(appliedDiscount.amount)}
                </p>
              )}
            </div>
            <Button className="w-full" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />{t("print_receipt")}</Button>
            {canCorrect && (
              <Button variant="outline" className="w-full border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400" onClick={openCorr}>
                <PencilLine className="h-4 w-4 mr-2" />Edit Payment Type
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={() => { setRefundAmt(Number(bill.total)); setRefundOpen(true); }}>
              <RotateCcw className="h-4 w-4 mr-2" />{t("refund")}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => nav({ to: "/pos" })}>{t("back")}</Button>
          </div>
        )}
      </aside>

      {/* ── Discount dialog ──────────────────────────────────────────────────── */}
      <Dialog open={discDlgOpen} onOpenChange={setDiscDlgOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              {appliedDiscount ? t("change_discount") : t("apply_discount")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            {lang === "th" ? "มีส่วนลดได้ครั้งละ 1 รายการ ใส่ใหม่จะแทนที่รายการเดิม" : "One discount per order — applying a new one replaces the existing."}
          </p>
          <p className="text-xs text-muted-foreground -mt-1">
            {lang === "th" ? `ส่วนลดสูงสุดต่อบิล: ${settingsMaxDiscountPercent}%` : `Maximum discount per bill: ${settingsMaxDiscountPercent}%`}
          </p>

          <Tabs value={discDlgTab} onValueChange={(v) => setDiscDlgTab(v as typeof discDlgTab)}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="percent"><Percent className="h-3.5 w-3.5 mr-1" />{t("disc_pct")}</TabsTrigger>
              <TabsTrigger value="fixed"><DollarSign className="h-3.5 w-3.5 mr-1" />{t("disc_fixed")}</TabsTrigger>
              <TabsTrigger value="free_item"><Gift className="h-3.5 w-3.5 mr-1" />{t("disc_free_item")}</TabsTrigger>
            </TabsList>

            {/* % Off */}
            <TabsContent value="percent" className="pt-3 space-y-3">
              <div>
                <Label>{lang === "th" ? "ลดกี่ %" : "Percentage off"}</Label>
                <div className="mt-1">
                  <KeypadInput
                    value={discPctInput}
                    onChange={(n) => setDiscPctInput(Math.min(settingsMaxDiscountPercent, n))}
                    title={lang === "th" ? "ลดกี่ %" : "Percentage off"}
                    display={(n) => `${n}%`}
                    placeholder="0%"
                  />
                </div>
                {/* Quick picks */}
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {[5, 10, 15, 20, 25, 50].filter((p) => p <= settingsMaxDiscountPercent).map((p) => (
                    <button key={p} onClick={() => setDiscPctInput(p)}
                      className={`px-2.5 py-1 rounded-md border text-sm font-medium transition-colors ${discPctInput === p ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>
              {discPctInput > 0 && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{t("disc_saves")}</p>
                  <p className="text-2xl font-black text-green-600 dark:text-green-400 tabular-nums">- {thb(discPreviewAmt)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{lang === "th" ? "ยอดที่ต้องชำระ" : "New total"}: {thb(discPreviewTotal)}</p>
                </div>
              )}
            </TabsContent>

            {/* Fixed ฿ */}
            <TabsContent value="fixed" className="pt-3 space-y-3">
              <div>
                <Label>{lang === "th" ? "ลดเป็นจำนวนเงิน (บาท)" : "Amount to discount (฿)"}</Label>
                <div className="mt-1">
                  <KeypadInput value={discFixedInput} onChange={setDiscFixedInput} title={lang === "th" ? "ลดเป็นจำนวนเงิน" : "Amount to discount"} placeholder="0" />
                </div>
                <div className="flex gap-1.5 mt-2 flex-wrap">
                  {[20, 50, 100, 200, 500].map((a) => (
                    <button key={a} onClick={() => setDiscFixedInput(a)}
                      className={`px-2.5 py-1 rounded-md border text-sm font-medium transition-colors ${discFixedInput === a ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                      ฿{a}
                    </button>
                  ))}
                </div>
              </div>
              {discFixedInput > 0 && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{t("disc_saves")}</p>
                  <p className="text-2xl font-black text-green-600 dark:text-green-400 tabular-nums">- {thb(discPreviewAmt)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{lang === "th" ? "ยอดที่ต้องชำระ" : "New total"}: {thb(discPreviewTotal)}</p>
                </div>
              )}
            </TabsContent>

            {/* Free Item */}
            <TabsContent value="free_item" className="pt-3 space-y-2">
              <p className="text-xs text-muted-foreground">{t("disc_select_item")}</p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {items.map((i) => (
                  <button key={i.id}
                    onClick={() => setDiscFreeItemId(i.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${discFreeItemId === i.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}
                  >
                    <span className="truncate mr-2">{pickName(i, lang)} <span className="opacity-70">×{i.qty}</span></span>
                    <span className="shrink-0 font-semibold tabular-nums">{thb(i.qty * Number(i.unit_price))}</span>
                  </button>
                ))}
              </div>
              {discFreeItemId && (
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{t("disc_saves")}</p>
                  <p className="text-2xl font-black text-green-600 dark:text-green-400 tabular-nums">- {thb(discPreviewAmt)}</p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscDlgOpen(false)}>{t("cancel")}</Button>
            <Button onClick={applyDiscount} disabled={discPreviewAmt <= 0}>
              <Tag className="h-4 w-4 mr-1.5" />
              {appliedDiscount ? t("change_discount") : t("apply_discount")} {discPreviewAmt > 0 ? `· - ${thb(discPreviewAmt)}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Member search dialog ────────────────────────────────────────────── */}
      <Dialog open={memberSearchOpen} onOpenChange={(o) => { setMemberSearchOpen(o); if (!o) resetNewMember(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Heart className="h-4 w-4" />{newMemberMode ? "New member" : "Find member"}
            </DialogTitle>
          </DialogHeader>
          {newMemberMode ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Name *</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t("pay_customer_name")} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("loy_nickname")}</Label>
                  <Input value={newNick} onChange={(e) => setNewNick(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t("col_phone")}</Label>
                  <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="08x-xxx-xxxx" />
                </div>
              </div>
              {signupBonus > 0 && (
                <p className="text-xs text-muted-foreground">New member gets a {signupBonus.toLocaleString()}-point signup bonus.</p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={resetNewMember} disabled={creatingMember}>{t("back")}</Button>
                <Button onClick={createMember} disabled={creatingMember || (!newName.trim() && !newNick.trim())}>
                  {creatingMember ? "Creating…" : "Create & select"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={t("pay_search_ph")}
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void searchMembers(); }}
                  />
                </div>
                <Button onClick={searchMembers}>{t("search")}</Button>
              </div>
              <div className="max-h-80 overflow-y-auto space-y-2">
                {memberResults.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => selectMember(m)}
                    className="w-full rounded-lg border p-3 text-left hover:bg-accent transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{m.full_name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.nickname ? `${m.nickname} · ` : ""}{m.phone ?? "No phone"}{m.member_group_en ? ` · ${m.member_group_en}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-bold tabular-nums">{Number(m.current_points ?? 0).toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">points</div>
                      </div>
                    </div>
                  </button>
                ))}
                {memberResults.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No members found.</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMemberSearchOpen(false)}>{t("cancel")}</Button>
                <Button onClick={() => {
                  const q = memberQuery.trim();
                  const isPhone = /^[\d+\-\s]+$/.test(q) && /\d/.test(q);
                  setNewPhone(isPhone ? q : "");
                  setNewName(isPhone ? "" : q);
                  setNewNick("");
                  setNewMemberMode(true);
                }}>
                  <Heart className="h-4 w-4 mr-1" />New member
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Cash dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("cash_received")}</DialogTitle></DialogHeader>
          <div>
            <Label>{t("amount")}</Label>
            <KeypadInput value={cashAmount} onChange={setCashAmount} title={t("amount")} />
          </div>
          <div className="flex items-center justify-between pt-1">
            <Label className="text-xs text-muted-foreground">Tap a note/coin to add · − to remove one</Label>
            {cashTotal > 0 && (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setCashCount({})}>{t("clear")}</Button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {DENOMS.map((d) => {
              const count = cashCount[d] ?? 0;
              return (
                <div key={d} className="relative">
                  <button
                    type="button"
                    onClick={() => addDenom(d, 1)}
                    className={`w-full rounded-xl border-2 py-3 text-center transition-transform active:scale-95 ${count > 0 ? "border-primary bg-primary/10" : "border-muted hover:bg-muted/50"}`}
                  >
                    <div className="text-lg font-bold tabular-nums">฿{d}</div>
                    <div className={`text-xs mt-0.5 ${count > 0 ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                      {count > 0 ? `× ${count}` : "add"}
                    </div>
                  </button>
                  {count > 0 && (
                    <button
                      type="button"
                      onClick={() => addDenom(d, -1)}
                      aria-label={`Remove one ${d} baht`}
                      className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-destructive text-destructive-foreground grid place-content-center text-xl font-bold leading-none shadow"
                    >−</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-sm space-y-1 pt-2">
            <Row label={t("cash_received")} value={thb(cashTotal)} />
            <div className={`flex justify-between font-bold ${change > 0 ? "text-primary" : ""}`}>
              <span>{t("change")}</span><span className="tabular-nums">{thb(change)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCashOpen(false)}>{t("cancel")}</Button>
            <Button onClick={submitCash} disabled={cashTotal < cashAmount}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Refund dialog ────────────────────────────────────────────────────── */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("refund")}</DialogTitle></DialogHeader>
          <Label>{t("amount")}</Label>
          <KeypadInput value={refundAmt} onChange={setRefundAmt} title={t("refund")} placeholder="0" />
          <Label>{t("refund_reason")}</Label>
          <Textarea value={refundReason} onChange={(e) => setRefundReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={performRefund}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Split Bill dialog ───────────────────────────────────────────────── */}
      <SplitBillDialog
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        items={items}
        billTotal={total}
        remaining={remaining}
        lang={lang}
        t={t}
        onAddPayment={addPayment}
        paidStatus={paidStatus}
        govQrEnabled={govQrEnabled}
        govQrLabel={govQrLabel}
      />

      <ManagerPinDialog open={managerOpen} onOpenChange={setManagerOpen} onApproved={() => {
        if (pendingAction === "refund") doRefund();
        if (pendingAction === "correction") { setCorrChanges({}); setCorrReason(""); setCorrOpen(true); }
        setPendingAction(null);
      }} />

      {/* ── Payment type correction dialog ──────────────────────────────────── */}
      <Dialog open={corrOpen} onOpenChange={setCorrOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PencilLine className="h-4 w-4" />{t("pay_edit_type")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">Admin / Manager only · logged for audit</p>
          <div className="space-y-3 pt-1">
            {payments.map((p) => {
              const next = corrChanges[p.id] ?? p.method;
              const changed = next !== p.method;
              return (
                <div key={p.id} className={`flex items-center gap-3 rounded-lg border p-2 ${changed ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30" : ""}`}>
                  <span className="text-sm font-medium w-20 shrink-0">{thb(p.amount)}</span>
                  <Select value={next} onValueChange={(v) => setCorrChanges({ ...corrChanges, [p.id]: v as PaymentMethod })}>
                    <SelectTrigger className="flex-1 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">{t("pm_cash")}</SelectItem>
                      <SelectItem value="qr">QR Transfer</SelectItem>
                      <SelectItem value="gov_qr">Government QR {govQrLabel}</SelectItem>
                      <SelectItem value="card">{t("credit_card")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {changed && <span className="text-xs text-amber-600 shrink-0">{p.method} → {next}</span>}
                </div>
              );
            })}
          </div>
          <div>
            <Label className="text-xs">{t("pay_reason_optional")}</Label>
            <Textarea value={corrReason} onChange={(e) => setCorrReason(e.target.value)}
              placeholder="e.g. Customer paid cash, entered QR by mistake" className="text-sm" rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrOpen(false)}>{t("cancel")}</Button>
            <Button onClick={applyCorrection}
              disabled={!payments.some((p) => corrChanges[p.id] && corrChanges[p.id] !== p.method)}>
              Apply Correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Customer-facing full-screen bill ────────────────────────────────── */}
      {customerViewOpen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-8 cursor-pointer select-none"
          onClick={() => setCustomerViewOpen(false)}>
          <p className="text-base text-muted-foreground">{restName}</p>
          <p className="text-3xl font-bold mt-1 mb-8">{t("table")} {tableCode}</p>
          <div className="w-full max-w-xs space-y-2 mb-6">
            {items.filter((i) => i.status !== "voided").map((i) => (
              <div key={i.id} className="flex justify-between text-lg">
                <span className="truncate mr-2">{pickName(i, lang)} <span className="text-muted-foreground text-base">×{i.qty}</span></span>
                <span className="shrink-0 tabular-nums">{thb(i.qty * Number(i.unit_price))}</span>
              </div>
            ))}
          </div>
          <div className="w-full max-w-xs space-y-1 text-base text-muted-foreground">
            {appliedDiscount && (
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span className="flex items-center gap-1"><Tag className="h-4 w-4" />{discTypeLabel(appliedDiscount)}</span>
                <span className="tabular-nums">- {thb(appliedDiscount.amount)}</span>
              </div>
            )}
              {memberDisc > 0 && <div className="flex justify-between"><span>{t("member_discount")}</span><span>- {thb(memberDisc)}</span></div>}
              {pointsDiscount > 0 && <div className="flex justify-between"><span>{t("pay_points_used")} ({pointsRedeemed.toLocaleString()})</span><span>- {thb(pointsDiscount)}</span></div>}
            {serviceFeeAmount > 0 && <div className="flex justify-between"><span>Service {settingsServiceFeeRate}%</span><span>{thb(serviceFeeAmount)}</span></div>}
            {settingsVatEnabled && settingsVatMode === "exclusive" && <div className="flex justify-between"><span>VAT {bill?.vat_rate}%</span><span>{thb(vatAmount)}</span></div>}
            {roundingAdjustment !== 0 && <div className="flex justify-between"><span>{t("set_rounding")}</span><span>{roundingAdjustment > 0 ? "+" : ""}{thb(roundingAdjustment)}</span></div>}
          </div>
          <div className="border-t w-full max-w-xs pt-6 text-center mt-4">
            <p className="text-muted-foreground text-lg">{t("total")}</p>
            <p className="text-8xl font-black mt-2 tabular-nums">{thb(total)}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-16 animate-pulse">{t("tap_to_close")}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Split Bill Dialog
// ─────────────────────────────────────────────────────────────────────────────
type SplitStep = "choose" | "even_setup" | "even_pay" | "item_assign" | "item_pay" | "amount_pay";
type PayMethod = PaymentMethod;

function SplitBillDialog({
  open, onClose, items, billTotal, remaining, lang, t, onAddPayment, paidStatus, govQrEnabled, govQrLabel,
}: {
  open: boolean; onClose: () => void;
  items: Item[]; billTotal: number; remaining: number;
  lang: "th" | "en"; t: (k: string) => string;
  onAddPayment: (m: PayMethod, amount: number, extras?: Record<string, unknown>) => Promise<void>;
  paidStatus: boolean;
  govQrEnabled: boolean;
  govQrLabel: string;
}) {
  const [step, setStep] = useState<SplitStep>("choose");
  const [ways, setWays] = useState(2);
  // capturedAmount = remaining snapshotted when split starts (so per-share math stays stable)
  const [capturedAmount, setCapturedAmount] = useState(0);
  const [paidCount, setPaidCount] = useState(0);         // even split: seats paid so far
  const [personCount, setPersonCount] = useState(2);     // item split: how many people
  const [assignments, setAssignments] = useState<Record<string, number>>({}); // item.id → 0-based person
  const [paidPersons, setPaidPersons] = useState<Set<number>>(new Set());
  const [amountEntry, setAmountEntry] = useState(0); // split-by-amount: amount the current guest pays

  // Payment sub-form state
  const [payMethod, setPayMethod] = useState<PayMethod>("cash");
  const [cashReceived, setCashReceived] = useState(0);
  const [qrTip, setQrTip] = useState(0);
  const [processing, setProcessing] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("choose"); setWays(2); setCapturedAmount(0);
      setPaidCount(0); setPersonCount(2);
      setAssignments({}); setPaidPersons(new Set());
      setPayMethod("cash"); setCashReceived(0); setQrTip(0); setProcessing(false);
      setAmountEntry(0);
    }
  }, [open]);

  // Reset cash fields when moving between seats/persons
  useEffect(() => { setCashReceived(0); setQrTip(0); }, [paidCount, paidPersons]);
  // Split-by-amount: default the entry to the current balance after each payment
  useEffect(() => { if (step === "amount_pay") { setAmountEntry(remaining); setCashReceived(0); setQrTip(0); } }, [remaining, step]);

  // ── Even split helpers ──
  const baseShare = capturedAmount > 0 ? Math.floor(capturedAmount / ways * 100) / 100 : 0;
  const evenShareFor = (idx: number) =>
    idx === ways - 1 ? Math.round((capturedAmount - baseShare * (ways - 1)) * 100) / 100 : baseShare;
  const currentEvenShare = paidCount === ways - 1 ? remaining : evenShareFor(paidCount);

  // ── Item split helpers ──
  const subtotalItems = items.reduce((s, i) => s + i.qty * Number(i.unit_price), 0);
  const personItems = (pIdx: number) => items.filter((i) => assignments[i.id] === pIdx);
  const personRaw = (pIdx: number) => personItems(pIdx).reduce((s, i) => s + i.qty * Number(i.unit_price), 0);
  // Display share (proportional to bill total, based on captured amount)
  const personDisplayShare = (pIdx: number) => {
    if (subtotalItems === 0) return 0;
    return Math.round((personRaw(pIdx) / subtotalItems) * capturedAmount * 100) / 100;
  };
  const allAssigned = items.every((i) => assignments[i.id] !== undefined);
  const unpaidPersons = Array.from({ length: personCount }, (_, i) => i).filter((i) => !paidPersons.has(i));
  const currentPersonIdx = unpaidPersons[0] ?? 0;
  const isLastPerson = unpaidPersons.length === 1;
  const currentItemShare = isLastPerson ? remaining : personDisplayShare(currentPersonIdx);

  // ── Current amount to pay ──
  const currentAmount = step === "even_pay" ? currentEvenShare : step === "item_pay" ? currentItemShare : step === "amount_pay" ? amountEntry : 0;
  const cashChange = Math.max(0, cashReceived - currentAmount);

  const handlePay = async () => {
    if (processing || currentAmount <= 0) return;
    setProcessing(true);
    try {
      if (payMethod === "cash") {
        if (cashReceived < currentAmount) { toast.error(lang === "th" ? "เงินไม่พอ" : "Not enough cash"); return; }
        await onAddPayment("cash", currentAmount, { cash_received: cashReceived, change_due: cashChange });
      } else if (payMethod === "qr") {
        await onAddPayment("qr", currentAmount, { tip_amount: qrTip });
        setQrTip(0);
      } else if (payMethod === "gov_qr") {
        await onAddPayment("gov_qr", currentAmount, { reference: govQrLabel });
      } else {
        await onAddPayment("card", currentAmount);
      }
      if (step === "even_pay") {
        setPaidCount((c) => c + 1);
      } else if (step === "item_pay") {
        setPaidPersons((prev) => new Set([...prev, currentPersonIdx]));
      }
      // amount_pay: no per-person counter; the balance drives completion and the
      // entry effect resets the amount field to whatever is left.
    } finally {
      setProcessing(false);
    }
  };

  const allDone = paidStatus || remaining <= 0;
  const payDisabled = processing
    || currentAmount <= 0
    || (payMethod === "cash" && (cashReceived <= 0 || cashReceived < currentAmount));

  const personLabel = (i: number) => `${t("split_person")} ${i + 1}`;
  const ofN = (n: number) => lang === "th" ? `จาก ${n}` : `of ${n}`;

  // ── Quick cash buttons ──
  const quickCash = (amt: number) => [50, 100, 200, 500, 1000].filter((d) => d >= amt).slice(0, 4);

  // ── Progress bar shared component ──
  const ProgressBar = ({ total: n, done }: { total: number; done: number }) => (
    <div className="flex gap-1.5 mb-1">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={`flex-1 h-2 rounded-full transition-colors ${i < done ? "bg-green-500" : i === done ? "bg-primary" : "bg-muted"}`} />
      ))}
    </div>
  );

  // ── Payment sub-form ──
  const PayForm = ({ amount }: { amount: number }) => (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["cash", "qr", ...(govQrEnabled ? ["gov_qr" as const] : []), "card"] as const).map((m) => (
          <button key={m} onClick={() => setPayMethod(m)}
            className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${payMethod === m ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted/60"}`}>
            {m === "cash" ? t("cash") : m === "qr" ? "QR" : m === "gov_qr" ? govQrLabel : t("card")}
          </button>
        ))}
      </div>

      {payMethod === "cash" && (
        <div className="space-y-2">
          <Label className="text-xs">{t("cash_received")}</Label>
          <KeypadInput value={cashReceived} onChange={setCashReceived} title={t("cash_received")} placeholder={String(Math.ceil(amount))} />
          {cashReceived > 0 && (
            <div className="flex justify-between text-sm bg-muted rounded px-3 py-2">
              <span>{t("change")}</span>
              <span className="font-bold tabular-nums">{thb(cashChange)}</span>
            </div>
          )}
          <div className="flex gap-1.5 flex-wrap">
            {quickCash(amount).map((d) => (
              <button key={d} onClick={() => setCashReceived(d)}
                className={`px-3 py-1 rounded border text-sm font-medium transition-colors ${cashReceived === d ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}>
                ฿{d}
              </button>
            ))}
          </div>
        </div>
      )}

      {payMethod === "qr" && (
        <div className="space-y-2">
          <div className="flex justify-between text-sm bg-muted rounded px-3 py-2">
            <span>{t("amount")}</span><span className="font-bold tabular-nums">{thb(amount)}</span>
          </div>
          <div>
            <Label className="text-xs">{lang === "th" ? "ทิป (ถ้ามี)" : "Tip (optional)"}</Label>
            <KeypadInput value={qrTip} onChange={setQrTip} title={lang === "th" ? "ทิป" : "Tip"} placeholder="0" />
          </div>
          {qrTip > 0 && (
            <div className="flex justify-between text-sm bg-muted rounded px-3 py-2">
              <span>{lang === "th" ? "รวมทั้งหมด QR" : "Total QR charge"}</span>
              <span className="font-bold tabular-nums">{thb(amount + qrTip)}</span>
            </div>
          )}
        </div>
      )}

      {payMethod === "card" && (
        <div className="flex justify-between text-sm bg-muted rounded px-3 py-2">
          <span>{t("amount")}</span><span className="font-bold tabular-nums">{thb(amount)}</span>
        </div>
      )}

      {payMethod === "gov_qr" && (
        <div className="flex justify-between text-sm bg-muted rounded px-3 py-2">
          <span>{govQrLabel}</span><span className="font-bold tabular-nums">{thb(amount)}</span>
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />
            {t("split_bill")} · <span className="text-primary tabular-nums">{thb(billTotal)}</span>
          </DialogTitle>
        </DialogHeader>

        {/* ── All done ── */}
        {allDone && (
          <div className="text-center py-6 space-y-3">
            <div className="text-5xl">✅</div>
            <p className="text-xl font-bold">{t("split_all_paid")}</p>
            <Button className="w-full" onClick={onClose}>{t("back")}</Button>
          </div>
        )}

        {/* ── Choose mode ── */}
        {!allDone && step === "choose" && (
          <div className="space-y-3 py-1">
            <button
              className="w-full rounded-xl border-2 hover:border-primary/60 bg-card p-4 text-left transition-colors hover:bg-primary/5"
              onClick={() => { setCapturedAmount(remaining); setStep("even_setup"); }}
            >
              <div className="font-semibold text-base">{t("split_evenly")}</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {lang === "th" ? "แบ่งยอดเท่าๆ กันทุกคน" : "Divide the total equally between guests"}
              </div>
            </button>
            <button
              className="w-full rounded-xl border-2 hover:border-primary/60 bg-card p-4 text-left transition-colors hover:bg-primary/5"
              onClick={() => { setCapturedAmount(remaining); setStep("item_assign"); }}
            >
              <div className="font-semibold text-base">{t("split_by_item")}</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {lang === "th" ? "มอบหมายแต่ละรายการให้แต่ละคน แล้วชำระแยก" : "Assign each item to a person and pay separately"}
              </div>
            </button>
            <button
              className="w-full rounded-xl border-2 hover:border-primary/60 bg-card p-4 text-left transition-colors hover:bg-primary/5"
              onClick={() => { setCapturedAmount(remaining); setAmountEntry(remaining); setStep("amount_pay"); }}
            >
              <div className="font-semibold text-base">{t("split_by_amount")}</div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {lang === "th" ? "ใส่จำนวนเงินที่แต่ละคนจ่าย จนกว่าจะครบ" : "Enter the amount each guest pays until the bill is covered"}
              </div>
            </button>
          </div>
        )}

        {/* ── Amount: pay by entered amount until covered ── */}
        {!allDone && step === "amount_pay" && (
          <div className="space-y-4 py-1">
            <div className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{lang === "th" ? "จำนวนเงินที่ชำระ" : "Amount to pay"}</span>
                <span className="text-sm text-muted-foreground">
                  {lang === "th" ? "คงเหลือ" : "Remaining"} <span className="font-bold text-primary tabular-nums">{thb(remaining)}</span>
                </span>
              </div>
              <div>
                <Label className="text-xs">{t("amount")}</Label>
                <KeypadInput value={amountEntry} onChange={(n) => setAmountEntry(Math.min(remaining, n))} title={t("amount")} />
              </div>
              <div className="flex justify-between text-sm bg-muted rounded px-3 py-2">
                <span>{lang === "th" ? "คงเหลือหลังชำระ" : "Balance after this"}</span>
                <span className="font-bold tabular-nums">{thb(Math.max(0, remaining - amountEntry))}</span>
              </div>
              <PayForm amount={amountEntry} />
            </div>

            <Button className="w-full" size="lg" disabled={payDisabled} onClick={handlePay}>
              {processing ? "…" : `${t("pay")} · ${thb(amountEntry)}${payMethod === "qr" && qrTip > 0 ? ` + Tip ${thb(qrTip)}` : ""}`}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setStep("choose")}>{t("cancel")}</Button>
          </div>
        )}

        {/* ── Even: setup ── */}
        {!allDone && step === "even_setup" && (
          <div className="space-y-5 py-1">
            <div>
              <p className="text-sm font-medium mb-3">{t("split_ways")}</p>
              <div className="flex gap-2">
                {[2, 3, 4, 5, 6].map((n) => (
                  <button key={n} onClick={() => setWays(n)}
                    className={`flex-1 py-3 rounded-xl border-2 text-xl font-bold transition-colors ${ways === n ? "border-primary bg-primary/10 text-primary" : "border-muted hover:border-primary/40"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
              {Array.from({ length: ways }, (_, i) => {
                const sh = i === ways - 1
                  ? Math.round((remaining - Math.floor(remaining / ways * 100) / 100 * (ways - 1)) * 100) / 100
                  : Math.floor(remaining / ways * 100) / 100;
                return (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{personLabel(i)}</span>
                    <span className="font-bold tabular-nums">{thb(sh)}</span>
                  </div>
                );
              })}
              <div className="border-t pt-2 flex justify-between text-sm font-bold">
                <span>{t("total")}</span><span className="tabular-nums">{thb(remaining)}</span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")}>{t("cancel")}</Button>
              <Button onClick={() => { setPaidCount(0); setStep("even_pay"); }}>
                {lang === "th" ? "ถัดไป →" : "Continue →"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Even: pay each seat ── */}
        {!allDone && step === "even_pay" && (
          <div className="space-y-4 py-1">
            <ProgressBar total={ways} done={paidCount} />

            <div className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{personLabel(paidCount)} <span className="text-muted-foreground text-sm font-normal">{ofN(ways)}</span></span>
                <span className="text-2xl font-black text-primary tabular-nums">{thb(currentEvenShare)}</span>
              </div>
              <PayForm amount={currentEvenShare} />
            </div>

            {/* Seat overview */}
            <div className="rounded-xl bg-muted/30 p-3 space-y-1.5 text-sm">
              {Array.from({ length: ways }, (_, i) => (
                <div key={i} className={`flex justify-between ${i === paidCount ? "font-semibold text-primary" : i < paidCount ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                  <span className="flex items-center gap-1.5">
                    {i < paidCount && <Check className="h-3 w-3 text-green-500" />}
                    {personLabel(i)}
                    {i === paidCount && <span className="text-xs opacity-70">← {t("split_paying")}</span>}
                  </span>
                  <span className="tabular-nums">{thb(evenShareFor(i))}</span>
                </div>
              ))}
            </div>

            <Button className="w-full" size="lg" disabled={payDisabled} onClick={handlePay}>
              {processing ? "…" : `${t("pay")} · ${thb(currentEvenShare)}${payMethod === "qr" && qrTip > 0 ? ` + Tip ${thb(qrTip)}` : ""}`}
            </Button>
          </div>
        )}

        {/* ── Item: assign ── */}
        {!allDone && step === "item_assign" && (
          <div className="space-y-4 py-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{t("split_assign_items")}</p>
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-1">{lang === "th" ? "คน:" : "People:"}</span>
                {[2, 3, 4, 5, 6].map((n) => (
                  <button key={n} onClick={() => setPersonCount(n)}
                    className={`h-7 w-7 rounded-lg border text-xs font-bold transition-colors ${personCount === n ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted/60"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Per-person totals preview */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {Array.from({ length: personCount }, (_, pIdx) => (
                <div key={pIdx} className={`shrink-0 rounded-xl border px-3 py-2 text-center min-w-[72px] ${personRaw(pIdx) > 0 ? "border-primary/40 bg-primary/5" : "bg-muted/30"}`}>
                  <div className="text-xs font-semibold text-muted-foreground">{lang === "th" ? `คน ${pIdx + 1}` : `P${pIdx + 1}`}</div>
                  <div className="text-sm font-bold tabular-nums text-primary">{thb(personRaw(pIdx))}</div>
                </div>
              ))}
            </div>

            {/* Item assignment list */}
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
              {items.map((i) => {
                const asgn = assignments[i.id];
                return (
                  <div key={i.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${asgn === undefined ? "border-orange-300 bg-orange-50 dark:bg-orange-950/20" : "bg-card border-border"}`}>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{lang === "th" ? i.name_th : i.name_en}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {i.qty > 1 ? `×${i.qty} · ` : ""}{thb(i.qty * Number(i.unit_price))}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {Array.from({ length: personCount }, (_, pIdx) => (
                        <button key={pIdx} onClick={() => setAssignments({ ...assignments, [i.id]: pIdx })}
                          className={`h-7 w-7 rounded-lg border text-xs font-bold transition-colors ${asgn === pIdx ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted/60"}`}>
                          P{pIdx + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {!allAssigned && (
              <p className="text-xs text-orange-600 dark:text-orange-400">
                ⚠ {lang === "th" ? "กรุณามอบหมายทุกรายการก่อนดำเนินการต่อ" : "Please assign all items before continuing"}
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("choose")}>{t("cancel")}</Button>
              <Button disabled={!allAssigned} onClick={() => { setPaidPersons(new Set()); setStep("item_pay"); }}>
                {lang === "th" ? "ถัดไป →" : "Continue →"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── Item: pay each person ── */}
        {!allDone && step === "item_pay" && (
          <div className="space-y-4 py-1">
            <ProgressBar total={personCount} done={paidPersons.size} />

            <div className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">
                  {personLabel(currentPersonIdx)} <span className="text-muted-foreground text-sm font-normal">{ofN(personCount)}</span>
                </span>
                <span className="text-2xl font-black text-primary tabular-nums">{thb(currentItemShare)}</span>
              </div>

              {/* Their items */}
              <div className="rounded-lg bg-muted/30 p-2.5 space-y-1">
                {personItems(currentPersonIdx).map((i) => (
                  <div key={i.id} className="flex justify-between text-xs text-muted-foreground">
                    <span>{lang === "th" ? i.name_th : i.name_en}{i.qty > 1 ? ` ×${i.qty}` : ""}</span>
                    <span className="tabular-nums">{thb(i.qty * Number(i.unit_price))}</span>
                  </div>
                ))}
              </div>

              <PayForm amount={currentItemShare} />
            </div>

            {/* Person overview */}
            <div className="rounded-xl bg-muted/30 p-3 space-y-1.5 text-sm">
              {Array.from({ length: personCount }, (_, i) => (
                <div key={i} className={`flex justify-between ${i === currentPersonIdx ? "font-semibold text-primary" : paidPersons.has(i) ? "text-muted-foreground" : "text-muted-foreground/60"}`}>
                  <span className="flex items-center gap-1.5">
                    {paidPersons.has(i) && <Check className="h-3 w-3 text-green-500" />}
                    {personLabel(i)}
                    {i === currentPersonIdx && <span className="text-xs opacity-70">← {t("split_paying")}</span>}
                  </span>
                  <span className="tabular-nums">{thb(personDisplayShare(i))}</span>
                </div>
              ))}
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>{lang === "th" ? "คงเหลือ" : "Remaining"}</span>
                <span className="tabular-nums text-primary">{thb(remaining)}</span>
              </div>
            </div>

            <Button className="w-full" size="lg" disabled={payDisabled} onClick={handlePay}>
              {processing ? "…" : `${t("pay")} · ${thb(currentItemShare)}${payMethod === "qr" && qrTip > 0 ? ` + Tip ${thb(qrTip)}` : ""}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span><span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
