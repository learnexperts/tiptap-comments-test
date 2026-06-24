/**
 * Minimal jsdom setup for headless TipTap + collab integration tests.
 * Intentionally avoids the app-wide setupTests.js (MSW, mocks).
 */

// TipTap / ProseMirror expect layout APIs in the browser.
Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    toJSON() {
      return {}
    },
  }
}

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
