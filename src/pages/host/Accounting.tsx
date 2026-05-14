import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Layout } from '@/components/layout/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calculator, Info, Lock } from 'lucide-react';
import { ensureAccountingSeeded } from '@/lib/accounting/init';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AccountingDashboard } from '@/components/accounting/AccountingDashboard';
import { AccountingBookings } from '@/components/accounting/AccountingBookings';
import { AccountingExpenses } from '@/components/accounting/AccountingExpenses';
import { AccountingFixedAssets } from '@/components/accounting/AccountingFixedAssets';
import { AccountingChartOfAccounts } from '@/components/accounting/AccountingChartOfAccounts';
import { AccountingJournal } from '@/components/accounting/AccountingJournal';
import { AccountingReports } from '@/components/accounting/AccountingReports';
import { AccountingSettings } from '@/components/accounting/AccountingSettings';
import { Button } from '@/components/ui/button';
import { AccountingPinGate, isAcctUnlocked, clearAcctUnlock } from '@/components/accounting/AccountingPinGate';

export default function Accounting() {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('dashboard');
  const [reloadKey, setReloadKey] = useState(0);
  const [unlocked, setUnlocked] = useState<boolean>(() => false);

  useEffect(() => {
    if (!user) return;
    ensureAccountingSeeded(user.id)
      .catch((e) => console.error('Seed failed', e))
      .finally(() => setReady(true));
  }, [user]);

  // Re-evaluate unlock state when user changes
  useEffect(() => {
    if (user) setUnlocked(isAcctUnlocked(user.id));
  }, [user]);

  if (!user) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-8">
          <Card><CardContent className="p-6">Please sign in to access accounting.</CardContent></Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Calculator className="w-7 h-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Accounting</h1>
              <p className="text-sm text-muted-foreground">
                Double-entry bookkeeping for your short-term rental business.
              </p>
            </div>
          </div>
          {unlocked && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => { clearAcctUnlock(user.id); setUnlocked(false); }}
            >
              <Lock className="w-4 h-4 mr-2" /> Lock
            </Button>
          )}
        </div>

        {!ready ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : !unlocked ? (
          <AccountingPinGate
            hostId={user.id}
            onUnlocked={() => setUnlocked(true)}
          />
        ) : (
          <>
          <Alert className="mb-4">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Recognition policy:</strong> Rental income is booked in full on the
              <strong> guest's check-out date</strong>. Expenses are recorded on the date they occur.
            </AlertDescription>
          </Alert>
          <Tabs key={reloadKey} value={tab} onValueChange={setTab} className="space-y-4">
            <div className="overflow-x-auto">
              <TabsList className="flex w-max min-w-full">
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="bookings">Bookings</TabsTrigger>
                <TabsTrigger value="expenses">Expenses</TabsTrigger>
                <TabsTrigger value="assets">Fixed assets</TabsTrigger>
                <TabsTrigger value="coa">Chart of accounts</TabsTrigger>
                <TabsTrigger value="journal">Journal</TabsTrigger>
                <TabsTrigger value="reports">Reports</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="dashboard"><AccountingDashboard hostId={user.id} /></TabsContent>
            <TabsContent value="bookings"><AccountingBookings hostId={user.id} /></TabsContent>
            <TabsContent value="expenses"><AccountingExpenses hostId={user.id} /></TabsContent>
            <TabsContent value="assets"><AccountingFixedAssets hostId={user.id} /></TabsContent>
            <TabsContent value="coa"><AccountingChartOfAccounts hostId={user.id} /></TabsContent>
            <TabsContent value="journal"><AccountingJournal hostId={user.id} /></TabsContent>
            <TabsContent value="reports"><AccountingReports hostId={user.id} /></TabsContent>
            <TabsContent value="settings"><AccountingSettings hostId={user.id} /></TabsContent>
          </Tabs>
          </>
        )}
      </div>
    </Layout>
  );
}
