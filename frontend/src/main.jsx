import React from 'react';
import ReactDOM from 'react-dom/client';
// Design system: self-hosted variable fonts + Open Props tokens. Both are
// imported before the app so component CSS can read the tokens.
import '@fontsource-variable/inter';
import '@fontsource-variable/plus-jakarta-sans';
// Only the easing module is needed; importing all of open-props would ship
// ~30 kB of colour/scale tokens this design does not use.
import 'open-props/easings';
import App from './App.jsx';
import './index.css';
// Loaded last: the polish layer overrides App.css at equal specificity.
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
