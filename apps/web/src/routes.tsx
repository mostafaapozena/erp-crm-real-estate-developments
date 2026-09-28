import Box from '@mui/material/Box';
import { StateView } from '@alola/ui';
import { Suspense, lazy } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { useLocale } from './locale';

/**
 * Route-level code splitting.
 *
 * Every feature area is a separate chunk, so the first download is the shell and nothing else. A
 * collections officer never fetches the marketing screens, and adding a feature area costs the other
 * roles nothing — which is what keeps the bundle budget reachable as the product grows rather than
 * something to renegotiate.
 *
 * Each lazy page gets a **stable fallback** of the height the content will occupy, so the layout does
 * not jump, and a chunk that fails to arrive gets a retry rather than a blank page.
 */
const Dashboard = lazy(() => import('./pages/DashboardPage'));
const Leads = lazy(() => import('./pages/LeadsPage'));
const LeadDetail = lazy(() => import('./pages/LeadDetailPage'));
const Customers = lazy(() => import('./pages/CustomersPage'));
const Projects = lazy(() => import('./pages/ProjectsPage'));
const Units = lazy(() => import('./pages/UnitsPage'));
const UnitDetail = lazy(() => import('./pages/UnitDetailPage'));
const Reservations = lazy(() => import('./pages/ReservationsPage'));
const ReservationNew = lazy(() => import('./pages/ReservationNewPage'));
const ReservationDetail = lazy(() => import('./pages/ReservationDetailPage'));
const Contracts = lazy(() => import('./pages/ContractsPage'));
const ContractDetail = lazy(() => import('./pages/ContractDetailPage'));
const Installments = lazy(() => import('./pages/InstallmentsPage'));
const Receipts = lazy(() => import('./pages/ReceiptsPage'));
const ReceiptDetail = lazy(() => import('./pages/ReceiptDetailPage'));
const Instruments = lazy(() => import('./pages/InstrumentsPage'));
const Reminders = lazy(() => import('./pages/RemindersPage'));
const Campaigns = lazy(() => import('./pages/CampaignsPage'));
const Organization = lazy(() => import('./pages/OrganizationPage'));
const Notifications = lazy(() => import('./pages/NotificationsPage'));
const Tasks = lazy(() => import('./pages/TasksPage'));
const Imports = lazy(() => import('./pages/ImportsPage'));
const CompanyIdentity = lazy(() => import('./pages/CompanyIdentityPage'));
const NotFound = lazy(() => import('./pages/NotFoundPage'));

/** Tall enough that the page does not reflow when the chunk arrives. */
export function RouteFallback() {
  const { t } = useLocale();
  return (
    <Box
      sx={{ minHeight: 320, display: 'grid', alignContent: 'center' }}
      data-testid="route-fallback"
    >
      <StateView
        kind="loading"
        title={t('shell.loadingSection')}
        description={t('states.loadingDescription')}
      />
    </Box>
  );
}

export function AppRoutes() {
  const { t } = useLocale();
  const location = useLocation();
  return (
    // Keyed by path so an error on one screen does not keep the next one from rendering.
    <RouteErrorBoundary
      key={location.pathname}
      title={t('states.errorTitle')}
      description={t('states.errorDescription')}
      retryLabel={t('states.retry')}
    >
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:leadId" element={<LeadDetail />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/units" element={<Units />} />
          <Route path="/units/:unitId" element={<UnitDetail />} />
          <Route path="/reservations" element={<Reservations />} />
          <Route path="/reservations/new" element={<ReservationNew />} />
          <Route path="/reservations/:reservationId" element={<ReservationDetail />} />
          <Route path="/contracts" element={<Contracts />} />
          <Route path="/contracts/:contractId" element={<ContractDetail />} />
          <Route path="/installments" element={<Installments />} />
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/receipts/:receiptId" element={<ReceiptDetail />} />
          <Route path="/instruments" element={<Instruments />} />
          <Route path="/reminders" element={<Reminders />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/organization" element={<Organization />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/imports" element={<Imports />} />
          <Route path="/settings/company" element={<CompanyIdentity />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}
