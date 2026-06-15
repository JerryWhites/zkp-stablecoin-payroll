import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import ProtectedRoute from "@/components/ProtectedRoute";
import ErrorBoundary from "@/components/ErrorBoundary";
import CZPayrollLayout from "@/components/CZPayrollLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import PayrollApp from "./pages/PayrollApp";
import Subscription from "./pages/Subscription";
import CompanySetup from "./pages/CompanySetup";
import EmployeeManagement from "./pages/EmployeeManagement";
import PayrollWizard from "./pages/PayrollWizard";
import Settings from "./pages/Settings";
import AuditLog from "./pages/AuditLog";
import OSVCDashboard from "./pages/OSVCDashboard";
import AnnualProcessing from "./pages/AnnualProcessing";
import ApiKeys from "./pages/ApiKeys";
import Scheduler from "./pages/Scheduler";
import ReportBuilder from "./pages/ReportBuilder";
import Webhooks from "./pages/Webhooks";
import Approvals from "./pages/Approvals";
import WhiteLabel from "./pages/WhiteLabel";
import DedicatedManager from "./pages/DedicatedManager";
import SLADashboard from "./pages/SLADashboard";
import Vacations from "./pages/Vacations";
import Deductions from "./pages/Deductions";
import Timesheets from "./pages/Timesheets";
import Benefits from "./pages/Benefits";
import Organization from "./pages/Organization";
import Portal from "./pages/Portal";
import Commissions from "./pages/Commissions";
import Onboarding from "./pages/Onboarding";
import Accounting from "./pages/Accounting";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <ErrorBoundary>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/dashboard" element={<ProtectedRoute><CZPayrollLayout><Dashboard /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/app" element={<ProtectedRoute><CZPayrollLayout><PayrollApp /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/subscription" element={<ProtectedRoute><CZPayrollLayout><Subscription /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/company" element={<ProtectedRoute><CZPayrollLayout><CompanySetup /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/employees" element={<ProtectedRoute><CZPayrollLayout><EmployeeManagement /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/payroll" element={<ProtectedRoute><CZPayrollLayout><PayrollWizard /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/osvc" element={<ProtectedRoute><CZPayrollLayout><OSVCDashboard /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/annual" element={<ProtectedRoute><CZPayrollLayout><AnnualProcessing /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/settings" element={<ProtectedRoute><CZPayrollLayout><Settings /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/audit-log" element={<ProtectedRoute roles={["admin", "owner"]}><CZPayrollLayout><AuditLog /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/api-keys" element={<ProtectedRoute roles={["admin", "owner"]}><CZPayrollLayout><ApiKeys /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/scheduler" element={<ProtectedRoute roles={["admin", "owner"]}><CZPayrollLayout><Scheduler /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/reports" element={<ProtectedRoute><CZPayrollLayout><ReportBuilder /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/webhooks" element={<ProtectedRoute roles={["admin", "owner"]}><CZPayrollLayout><Webhooks /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/approvals" element={<ProtectedRoute><CZPayrollLayout><Approvals /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/whitelabel" element={<ProtectedRoute roles={["admin", "owner"]}><CZPayrollLayout><WhiteLabel /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/manager" element={<ProtectedRoute roles={["admin", "owner"]}><CZPayrollLayout><DedicatedManager /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/sla" element={<ProtectedRoute roles={["admin", "owner"]}><CZPayrollLayout><SLADashboard /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/vacations" element={<ProtectedRoute><CZPayrollLayout><Vacations /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/deductions" element={<ProtectedRoute><CZPayrollLayout><Deductions /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/timesheets" element={<ProtectedRoute><CZPayrollLayout><Timesheets /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/benefits" element={<ProtectedRoute><CZPayrollLayout><Benefits /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/organization" element={<ProtectedRoute><CZPayrollLayout><Organization /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/portal" element={<ProtectedRoute><CZPayrollLayout><Portal /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/commissions" element={<ProtectedRoute><CZPayrollLayout><Commissions /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/onboarding" element={<ProtectedRoute><CZPayrollLayout><Onboarding /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/cz/accounting" element={<ProtectedRoute><CZPayrollLayout><Accounting /></CZPayrollLayout></ProtectedRoute>} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
