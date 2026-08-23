import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import { I18nProvider } from '../../src/lib/i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider storage={browser.storage.local}>
      <Popup />
    </I18nProvider>
  </React.StrictMode>,
);
