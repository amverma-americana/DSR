import React from 'react';
import ReactDOM from 'react-dom/client';

/*  Inter, self-hosted.
    Bundled through @fontsource rather than linked from Google Fonts on purpose: the application is
    an internal enterprise tool that may run on a restricted network, and a webfont fetched from a
    third-party CDN either blocks first paint or silently falls back on machines without outbound
    internet access. Only the four weights the type scale actually uses are imported.  */
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
