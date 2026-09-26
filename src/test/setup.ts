import '@testing-library/jest-dom';
import { vi } from 'vitest';

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

window.ResizeObserver = ResizeObserverMock as any;

// JSDOM defines a native DOM Plugin constructor that throws "Illegal constructor"
// when called with `new`. ProseMirror's Plugin happens to share the same name.
// Replace it globally before any test module loads so every extension gets the
// mocked version automatically.
const RealPlugin = (globalThis as any).Plugin;
if (RealPlugin) {
  (globalThis as any).Plugin = class MockPlugin {
    constructor() {}
  } as any;
}
