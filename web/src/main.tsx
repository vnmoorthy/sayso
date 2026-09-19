import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'framer-motion';
import App from './App';
import { INSTANT } from './lib/flags';
import './index.css';

if (INSTANT) {
  // Headless-screenshot mode: land every animation on its final frame.
  MotionGlobalConfig.skipAnimations = true;
  document.documentElement.dataset.instant = '1';
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(<App />);
