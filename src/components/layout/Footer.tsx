import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Globe, MessageCircle, Mail, Phone } from 'lucide-react';
import { languages } from '@/i18n';
import hostivaLogo from '@/assets/hostiva-logo.png';
import { usePlatformBranding, phoneToE164 } from '@/hooks/usePlatformBranding';

const buildFooterWhatsAppUrl = (phone: string, brandName: string) => {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const msg = `Hi ${brandName}! I have a question.\n\nPage: ${url}`;
  return `https://wa.me/${phoneToE164(phone).replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
};

export function Footer() {
  const { t, i18n } = useTranslation();
  const currentLang = languages.find(l => l.code === i18n.language) || languages[0];
  const branding = usePlatformBranding();

  return (
    <footer className="bg-secondary border-t border-border">
      <div className="container mx-auto px-4 md:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <h3 className="font-display font-bold text-sm mb-4">{t('footer.support')}</h3>
            <ul className="space-y-3">
              <li><Link to="/info/help-center" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.helpCenter')}</Link></li>
              <li><Link to="/info/contact" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.contactUs')}</Link></li>
              <li><Link to="/info/safety" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.safetyStay')}</Link></li>
              <li><Link to="/safety-center" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.safetyCenter')}</Link></li>
              <li><Link to="/info/accessibility" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.accessibility')}</Link></li>
              <li><Link to="/cancellation-policy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.cancellationOptions')}</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-display font-bold text-sm mb-4">{t('footer.hosting')}</h3>
            <ul className="space-y-3">
              <li><Link to="/become-host" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.listSpace')}</Link></li>
              <li><Link to="/info/host-resources" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.hostResources')}</Link></li>
              <li><Link to="/info/community-forum" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.communityForum')}</Link></li>
              <li><Link to="/info/responsible-hosting" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.responsibleHosting')}</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-display font-bold text-sm mb-4">{t('footer.hostly')}</h3>
            <ul className="space-y-3">
              <li><Link to="/info/newsroom" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.newsroom')}</Link></li>
              <li><Link to="/info/new-features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.newFeatures')}</Link></li>
              <li><Link to="/info/careers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.careers')}</Link></li>
              <li><Link to="/info/investors" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t('footer.investors')}</Link></li>
            </ul>
          </div>

          <div>
            <div className="mb-4">
              {/* Transparent logo — sits naturally on the footer surface and
                  gets a soft white plate in dark mode for contrast. */}
              <img
                src={hostivaLogo}
                alt="Hostiva"
                className="block h-16 w-auto object-contain dark:bg-white/95 dark:rounded-md dark:px-3 dark:py-2"
                loading="lazy"
                decoding="async"
              />
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed mb-4">
              {t('footer.brandDesc')}
            </p>
            <div className="space-y-2 mb-4 text-sm">
              <a href={`mailto:${branding.support_email}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Mail className="w-4 h-4 shrink-0" />
                {branding.support_email}
              </a>
              <a href={`tel:${phoneToE164(branding.support_phone)}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
                <Phone className="w-4 h-4 shrink-0" />
                {branding.support_phone}
              </a>
            </div>
            <a
              href={buildFooterWhatsAppUrl(branding.support_phone, branding.platform_name)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#25D366] text-white text-sm font-semibold hover:bg-[#20BA5A] transition-colors shadow-sm"
              aria-label={`Chat with ${branding.platform_name} on WhatsApp`}
            >
              <MessageCircle className="w-4 h-4" />
              {t('footer.chatWhatsApp')}
            </a>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} {branding.platform_name}, Inc. &nbsp;·&nbsp;
            <Link to="#" className="hover:text-foreground">{t('footer.terms')}</Link> &nbsp;·&nbsp;
            <Link to="#" className="hover:text-foreground">{t('footer.privacy')}</Link> &nbsp;·&nbsp;
            <Link to="#" className="hover:text-foreground">{t('footer.sitemap')}</Link>
          </p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Globe className="w-4 h-4" />
              {currentLang.name} ({currentLang.region})
            </span>
            <span>$ USD</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
