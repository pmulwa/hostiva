import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Search from "./pages/Search";
import PropertyDetail from "./pages/PropertyDetail";
import Bookings from "./pages/Bookings";
import BookingConfirmation from "./pages/BookingConfirmation";
import BecomeHost from "./pages/BecomeHost";
import HostDashboard from "./pages/host/Dashboard";
import CreateProperty from "./pages/host/CreateProperty";
import EditProperty from "./pages/host/EditProperty";
import HostEarnings from "./pages/host/Earnings";
import FinancialBooks from "./pages/host/Accounting";
import HostReviews from "./pages/host/Reviews";
import CommunityForums from "./pages/host/CommunityForums";
import HostCalendar from "./pages/host/HostCalendar";
import HostIssues from "./pages/host/Issues";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminProperties from "./pages/admin/AdminProperties";
import AdminBookings from "./pages/admin/AdminBookings";
import AdminFinancials from "./pages/admin/AdminFinancials";
import AdminReviews from "./pages/admin/AdminReviews";
import AdminControls from "./pages/admin/AdminControls";
import AdminReports from "./pages/admin/AdminReports";
import AdminAuditLog from "./pages/admin/AdminAuditLog";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminVerifications from "./pages/admin/AdminVerifications";
import AdminHostPayments from "./pages/admin/AdminHostPayments";
import AdminModerationQueue from "./pages/admin/AdminModerationQueue";
import AdminAccounting from "./pages/admin/AdminAccounting";
import AdminTrustSafety from "./pages/admin/AdminTrustSafety";
import AdminReviewQueue from "./pages/admin/AdminReviewQueue";
import AdminForceMajeure from "./pages/admin/AdminForceMajeure";
import AdminPayoutTiers from "./pages/admin/AdminPayoutTiers";
import AdminRoles from "./pages/admin/AdminRoles";
import AdminMessages from "./pages/admin/AdminMessages";
import AdminReconciliation from "./pages/admin/AdminReconciliation";
import AdminAccountingPin from "./pages/admin/AdminAccountingPin";
import { RequirePermission } from "./components/admin/RequirePermission";
import { RequireHost } from "./components/RequireHost";
import HostPayoutSettings from "./pages/host/PayoutSettings";
import HostGuarantee from "./pages/HostGuarantee";
import Info from "./pages/Info";
import Contact from "./pages/Contact";
import Profile from "./pages/Profile";
import Favorites from "./pages/Favorites";
import Messages from "./pages/Messages";
import SettingsPage from "./pages/Settings";
import Suspended from "./pages/Suspended";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import PublicProfile from "./pages/PublicProfile";
import NotFound from "./pages/NotFound";
import CancellationPolicy from "./pages/CancellationPolicy";
import SafetyCenter from "./pages/SafetyCenter";
import { MaintenanceGuard } from "./components/MaintenanceGuard";
import { ThemeApplier } from "./components/ThemeApplier";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <ThemeApplier />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <MaintenanceGuard>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/suspended" element={<Suspended />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/search" element={<Search />} />
            <Route path="/property/:id" element={<PropertyDetail />} />
            <Route path="/bookings" element={<Bookings />} />
            <Route path="/booking-confirmation/:id" element={<BookingConfirmation />} />
            <Route path="/become-host" element={<BecomeHost />} />
            <Route path="/host/dashboard" element={<RequireHost><HostDashboard /></RequireHost>} />
            <Route path="/host/properties/new" element={<RequireHost><CreateProperty /></RequireHost>} />
            <Route path="/host/properties/:id/edit" element={<RequireHost><EditProperty /></RequireHost>} />
            <Route path="/host/earnings" element={<RequireHost><HostEarnings /></RequireHost>} />
            <Route path="/host/financial-books" element={<RequireHost><FinancialBooks /></RequireHost>} />
            <Route path="/host/accounting" element={<RequireHost><FinancialBooks /></RequireHost>} />
            <Route path="/host/reviews" element={<RequireHost><HostReviews /></RequireHost>} />
            <Route path="/host/calendar" element={<RequireHost><HostCalendar /></RequireHost>} />
            <Route path="/host/community" element={<RequireHost><CommunityForums /></RequireHost>} />
            <Route path="/host/issues" element={<RequireHost><HostIssues /></RequireHost>} />
            {/* Admin routes */}
            <Route path="/admin" element={<AdminUsers />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/properties" element={<AdminProperties />} />
            <Route path="/admin/bookings" element={<AdminBookings />} />
            <Route path="/admin/financials" element={<RequirePermission permission="view_payouts"><AdminFinancials /></RequirePermission>} />
            <Route path="/admin/reviews" element={<AdminReviews />} />
            <Route path="/admin/controls" element={<AdminControls />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
            <Route path="/admin/audit-log" element={<AdminAuditLog />} />
            <Route path="/admin/verifications" element={<AdminVerifications />} />
            <Route path="/admin/host-payments" element={<RequirePermission permission="manage_payouts"><AdminHostPayments /></RequirePermission>} />
            <Route path="/admin/accounting" element={<RequirePermission permission="view_finance" inline><AdminAccounting /></RequirePermission>} />
            <Route path="/admin/reconciliation" element={<RequirePermission permission="view_payouts" inline><AdminReconciliation /></RequirePermission>} />
            <Route path="/admin/accounting-pin" element={<RequirePermission permission="manage_platform_settings" inline><AdminAccountingPin /></RequirePermission>} />
            <Route path="/admin/moderation" element={<AdminModerationQueue />} />
            <Route path="/admin/trust-safety" element={<AdminTrustSafety />} />
            <Route path="/admin/review-queue" element={<RequirePermission permission="resolve_disputes"><AdminReviewQueue /></RequirePermission>} />
            <Route path="/admin/force-majeure" element={<AdminForceMajeure />} />
            <Route path="/admin/payout-tiers" element={<RequirePermission permission="manage_payouts"><AdminPayoutTiers /></RequirePermission>} />
            <Route path="/admin/roles" element={<AdminRoles />} />
            <Route path="/admin/messages" element={<AdminMessages />} />
            <Route path="/host/payouts" element={<RequireHost><HostPayoutSettings /></RequireHost>} />
            <Route path="/host/payout-settings" element={<RequireHost><HostPayoutSettings /></RequireHost>} />
            <Route path="/host-guarantee" element={<HostGuarantee />} />
            <Route path="/info/contact" element={<Contact />} />
            <Route path="/cancellation-policy" element={<CancellationPolicy />} />
            <Route path="/safety-center" element={<SafetyCenter />} />
            <Route path="/info/:slug" element={<Info />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/user/:id" element={<PublicProfile />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </MaintenanceGuard>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
