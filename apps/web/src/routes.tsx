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
/**
 * The page chunks, one loader each. `lazy` renders from them, and `preloadPages` fetches them ahead of
 * need — once before a test file, so a cold compile is not timed as if it were a render.
 */
export const PAGE_MODULES = {
  Dashboard: () => import('./pages/DashboardPage'),
  Leads: () => import('./pages/LeadsPage'),
  LeadDetail: () => import('./pages/LeadDetailPage'),
  Customers: () => import('./pages/CustomersPage'),
  Projects: () => import('./pages/ProjectsPage'),
  Units: () => import('./pages/UnitsPage'),
  UnitDetail: () => import('./pages/UnitDetailPage'),
  Reservations: () => import('./pages/ReservationsPage'),
  ReservationNew: () => import('./pages/ReservationNewPage'),
  ReservationDetail: () => import('./pages/ReservationDetailPage'),
  Contracts: () => import('./pages/ContractsPage'),
  ContractDetail: () => import('./pages/ContractDetailPage'),
  Installments: () => import('./pages/InstallmentsPage'),
  Receipts: () => import('./pages/ReceiptsPage'),
  ReceiptDetail: () => import('./pages/ReceiptDetailPage'),
  Instruments: () => import('./pages/InstrumentsPage'),
  Reminders: () => import('./pages/RemindersPage'),
  Campaigns: () => import('./pages/CampaignsPage'),
  Organization: () => import('./pages/OrganizationPage'),
  Notifications: () => import('./pages/NotificationsPage'),
  Tasks: () => import('./pages/TasksPage'),
  Imports: () => import('./pages/ImportsPage'),
  CompanyIdentity: () => import('./pages/CompanyIdentityPage'),
  NotFound: () => import('./pages/NotFoundPage'),
} as const;

export function preloadPages(): Promise<unknown[]> {
  return Promise.all(Object.values(PAGE_MODULES).map((load) => load()));
}

const Dashboard = lazy(PAGE_MODULES.Dashboard);
const Leads = lazy(PAGE_MODULES.Leads);
const LeadDetail = lazy(PAGE_MODULES.LeadDetail);
const Customers = lazy(PAGE_MODULES.Customers);
const Projects = lazy(PAGE_MODULES.Projects);
const Units = lazy(PAGE_MODULES.Units);
const UnitDetail = lazy(PAGE_MODULES.UnitDetail);
const Reservations = lazy(PAGE_MODULES.Reservations);
const ReservationNew = lazy(PAGE_MODULES.ReservationNew);
const ReservationDetail = lazy(PAGE_MODULES.ReservationDetail);
const Contracts = lazy(PAGE_MODULES.Contracts);
const ContractDetail = lazy(PAGE_MODULES.ContractDetail);
const Installments = lazy(PAGE_MODULES.Installments);
const Receipts = lazy(PAGE_MODULES.Receipts);
const ReceiptDetail = lazy(PAGE_MODULES.ReceiptDetail);
const Instruments = lazy(PAGE_MODULES.Instruments);
const Reminders = lazy(PAGE_MODULES.Reminders);
const Campaigns = lazy(PAGE_MODULES.Campaigns);
const Organization = lazy(PAGE_MODULES.Organization);
const Notifications = lazy(PAGE_MODULES.Notifications);
const Tasks = lazy(PAGE_MODULES.Tasks);
const Imports = lazy(PAGE_MODULES.Imports);
const CompanyIdentity = lazy(PAGE_MODULES.CompanyIdentity);
const NotFound = lazy(PAGE_MODULES.NotFound);

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
