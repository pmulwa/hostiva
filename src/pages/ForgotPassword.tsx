import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Home, Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { useRateLimit } from '@/hooks/useRateLimit';

export default function ForgotPassword() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const { checkLimit, isLimited, cooldownSeconds } = useRateLimit({ maxAttempts: 3, windowMs: 60_000 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkLimit()) {
      toast({ title: t('forgotPassword.tooManyAttempts'), description: t('forgotPassword.waitSeconds', { seconds: cooldownSeconds }), variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    } else {
      setIsSent(true);
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary p-4">
      <div className="w-full max-w-md animate-scale-in">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Home className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="font-display text-2xl font-extrabold text-foreground">Hostiva</span>
        </Link>

        <Card className="shadow-xl border-border">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-2xl">
              {isSent ? t('forgotPassword.checkYourEmail') : t('forgotPassword.title')}
            </CardTitle>
            <CardDescription>
              {isSent ? t('forgotPassword.emailSent') : t('forgotPassword.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSent ? (
              <div className="text-center space-y-6">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                  <CheckCircle className="w-8 h-8 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {t('forgotPassword.didntReceive')}{' '}
                  <button onClick={() => setIsSent(false)} className="text-primary underline">
                    {t('forgotPassword.tryAgain')}
                  </button>.
                </p>
                <Button variant="outline" asChild className="w-full">
                  <Link to="/auth">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t('forgotPassword.backToSignIn')}
                  </Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t('forgotPassword.email')}</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('forgotPassword.emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full btn-primary" disabled={isLoading || isLimited}>
                  {isLimited ? t('forgotPassword.waitCountdown', { seconds: cooldownSeconds }) : isLoading ? t('forgotPassword.sending') : t('forgotPassword.sendResetLink')}
                </Button>
                <Button variant="ghost" asChild className="w-full">
                  <Link to="/auth">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t('forgotPassword.backToSignIn')}
                  </Link>
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
