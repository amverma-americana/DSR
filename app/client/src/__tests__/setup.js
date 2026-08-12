import '@testing-library/react';

/*  jsdom implements neither of these, and MUI plus Recharts both reach for them on mount.
    Without the stubs every render throws before a single assertion runs.  */

// MUI's useMediaQuery calls this to decide between the permanent and temporary drawer.
window.matchMedia = window.matchMedia || ((query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}));

// Recharts' ResponsiveContainer measures its parent through ResizeObserver.
global.ResizeObserver = global.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/*  ResponsiveContainer renders nothing at zero size, so the charts would mount empty and prove
    little. Reporting a real box makes the chart subtree actually render.  */
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 });
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });

// contentEditable formatting commands used by RichTextField.
document.execCommand = document.execCommand || (() => true);
