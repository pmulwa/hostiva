import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Mail, ArrowLeft } from 'lucide-react';

export default function Suspended() {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const reason = searchParams.get('reason') || t('suspended.defaultReason');

  return (
    <Layout>
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <Card className="max-w-lg w-full border-destructive/30">
          <CardContent className="pt-8 pb-8 text-center space-y-6">
            <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-10 h-10 text-destructive" />
            </div>

            <div>
              <h1 className="font-display text-2xl font-bold text-foreground mb-2">
                {t('suspended.title')}
              </h1>
              <p className="text-muted-foreground">
                {t('suspended.description')}
              </p>
            </div>

            <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 text-left">
              <p className="text-sm font-medium text-foreground mb-1">{t('suspended.reason')}</p>
              <p className="text-sm text-muted-foreground">{reason}</p>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('suspended.contactSupport')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button variant="outline" asChild>
                  <Link to="/">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t('suspended.backToHome')}
                  </Link>
                </Button>
                <Button variant="default" asChild>
                  <a href="mailto:support@hostly.com">
                    <Mail className="w-4 h-4 mr-2" />
                    {t('suspended.contactSupportBtn')}
                  </a>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
