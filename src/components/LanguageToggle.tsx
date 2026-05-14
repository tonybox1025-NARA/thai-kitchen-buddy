import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function LanguageToggle() {
  const { lang, setLang } = useI18n();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setLang(lang === "th" ? "en" : "th")}
      className="gap-2"
      title="Toggle language / สลับภาษา"
    >
      <Languages className="h-4 w-4" />
      <span className="font-semibold">{lang === "th" ? "TH" : "EN"}</span>
    </Button>
  );
}
