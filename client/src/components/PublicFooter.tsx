import { Link } from "wouter";
import LogoBrand from "@/components/LogoBrand";
import { useLang } from "@/i18n/LangContext";

export default function PublicFooter() {
  const { t } = useLang();

  return (
    <footer className="border-t border-border/50 py-12 mt-24">
      <div className="container">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center mb-4">
              <LogoBrand size="sm" />
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("footer_tagline")}
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-foreground mb-3">{t("footer_product")}</h4>
            <ul className="space-y-2">
              <li><Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("nav_pricing")}</Link></li>
              <li><Link href="/faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("nav_faq")}</Link></li>
              <li><Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("nav_dashboard")}</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-foreground mb-3">{t("footer_resources")}</h4>
            <ul className="space-y-2">
              <li><Link href="/documentation" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Documentation</Link></li>
              <li><Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Blog</Link></li>
              <li><Link href="/support" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Support</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm text-foreground mb-3">{t("footer_legal")}</h4>
            <ul className="space-y-2">
              <li><Link href="/cgu" className="text-sm text-muted-foreground hover:text-foreground transition-colors">CGU</Link></li>
              <li><Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("footer_privacy")}</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border/50 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">© 2025 Mar-ia. {t("footer_rights")}</p>
          <p className="text-xs text-muted-foreground">{t("footer_powered")}</p>
        </div>
      </div>
    </footer>
  );
}
