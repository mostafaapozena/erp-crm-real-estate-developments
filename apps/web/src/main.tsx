import './fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createI18n } from './i18n';

const i18n = createI18n((key) => {
  // A missing key is a defect: make it loud in development. The CI key check keeps it out of builds.
  console.error(`[i18n] Missing translation key: ${key}`);
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App i18n={i18n} />
  </StrictMode>,
);
