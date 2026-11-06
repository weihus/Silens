// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toJpeg, toPng } from 'html-to-image';
import { captureImage } from './imageExport';

vi.mock('html-to-image', () => ({ toPng: vi.fn(), toJpeg: vi.fn() }));
const dataUrl = 'data:image/png;base64,aGVsbG8=';
const fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');

function source() {
  const element = document.createElement('article');
  element.innerHTML = '<h1>Letter</h1><button>Real quotation</button><button data-export-exclude>Export</button><footer>Silens</footer>';
  element.style.width = '710px';
  document.body.appendChild(element);
  return element;
}
function dimensions(element: HTMLElement, width: number, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ width, height } as DOMRect);
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: height });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.mocked(toPng).mockResolvedValue(dataUrl);
  vi.mocked(toJpeg).mockResolvedValue(dataUrl);
  Object.defineProperty(document, 'fonts', { configurable: true, value: undefined });
  // Match the production fetch -> Blob -> ArrayBuffer path without changing other suites.
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => ({
    arrayBuffer: async () => new Uint8Array([104, 101, 108, 108, 111]).buffer,
  }) })));
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  if (fontsDescriptor) Object.defineProperty(document, 'fonts', fontsDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
});

it.each(['png', 'jpg'] as const)('captures %s with legacy options, theme color, width and actual bytes', async format => {
  const live = source();
  dimensions(live, 680, 400);
  const original = live.outerHTML;
  const capture = format === 'png' ? toPng : toJpeg;
  vi.mocked(capture).mockImplementation(async (clone, options) => {
    expect(clone.isConnected).toBe(true);
    expect(clone.dataset.imageExportSnapshot).toBeDefined();
    expect(clone.style.width).toBe('680px');
    expect(clone.style.color).toBe('rgb(18, 52, 86)');
    expect(clone.textContent).toContain('Letter');
    expect(clone.textContent).toContain('Real quotation');
    expect(clone.textContent).toContain('Silens');
    expect(options).toMatchObject({ quality: 0.95, pixelRatio: 2, backgroundColor: '#fff',
      style: { position: 'static', left: 'auto', top: 'auto' } });
    return dataUrl;
  });
  const bytes = await captureImage(live, { format, backgroundColor: '#fff', color: '#123456' });
  expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  expect(fetch).toHaveBeenCalledWith(dataUrl);
  expect(capture).toHaveBeenCalledOnce();
  expect(live.outerHTML).toBe(original);
  expect(document.querySelector('[data-image-export-snapshot]')).toBeNull();
  expect(document.body.children).toHaveLength(1);
});

it('freezes content, inherited fonts and theme variables synchronously while fonts load', async () => {
  const ready = deferred();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: ready.promise } });
  const live = source();
  live.style.fontFamily = 'serif';
  live.style.setProperty('--theme-accent', '#123456');
  const pending = captureImage(live, { format: 'png', backgroundColor: '#fff' });
  const clone = document.querySelector<HTMLElement>('[data-image-export-snapshot]')!;
  expect(clone).not.toBeNull();
  live.querySelector('h1')!.textContent = 'Changed';
  live.style.fontFamily = 'monospace';
  live.style.setProperty('--theme-accent', '#abcdef');
  expect(clone.querySelector('h1')!.textContent).toBe('Letter');
  expect(clone.style.fontFamily).toBe('serif');
  expect(clone.style.getPropertyValue('--theme-accent')).toBe('#123456');
  expect(toPng).not.toHaveBeenCalled();
  ready.resolve();
  await pending;
});

it('expands full-height content after fonts, strips only excluded controls and retains the footer', async () => {
  const live = source();
  live.style.height = '200px';
  live.style.maxHeight = '200px';
  live.style.overflow = 'auto';
  const original = live.outerHTML;
  await captureImage(live, { format: 'png', backgroundColor: '#fff', fullHeight: true,
    prepareClone: clone => {
      dimensions(clone, 710, 9000);
      expect(clone).not.toBe(live);
    },
  });
  const [clone, options] = vi.mocked(toPng).mock.calls[0];
  expect(clone.style.height).toBe('auto');
  expect(clone.style.maxHeight).toBe('none');
  expect(clone.style.overflow).toBe('visible');
  expect(clone.querySelector('[data-export-exclude]')).toBeNull();
  expect(clone.querySelector('button')?.textContent).toBe('Real quotation');
  expect(clone.querySelector('footer')?.textContent).toBe('Silens');
  expect(options).toMatchObject({ width: 710, height: 9000 });
  expect(options!.pixelRatio).toBeCloseTo(16384 / 9000);
  expect(live.outerHTML).toBe(original);
});

it('measures the complete snapshot only after fonts are ready', async () => {
  const ready = deferred();
  let fontsReady = false;
  let measured = false;
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: ready.promise } });
  const pending = captureImage(source(), { format: 'png', backgroundColor: '#fff', fullHeight: true,
    prepareClone: clone => {
      vi.spyOn(clone, 'getBoundingClientRect').mockImplementation(() => {
        measured = true;
        expect(fontsReady).toBe(true);
        return { width: 710, height: 1800 } as DOMRect;
      });
    },
  });
  expect(measured).toBe(false);
  fontsReady = true;
  ready.resolve();
  await pending;
  expect(measured).toBe(true);
  expect(vi.mocked(toPng).mock.calls[0][1]).toMatchObject({ width: 710, height: 1800 });
});

it('waits for clone image decoding before measuring and capturing', async () => {
  const live = source();
  live.appendChild(document.createElement('img'));
  const decoded = deferred();
  const decode = vi.fn(() => decoded.promise);
  const pending = captureImage(live, { format: 'png', backgroundColor: '#fff', fullHeight: true,
    prepareClone: clone => {
      Object.defineProperty(clone.querySelector('img'), 'decode', { value: decode });
      dimensions(clone, 710, 1200);
    },
  });
  await Promise.resolve();
  expect(decode).toHaveBeenCalledOnce();
  expect(toPng).not.toHaveBeenCalled();
  decoded.resolve();
  await pending;
  expect(vi.mocked(toPng).mock.calls[0][1]).toMatchObject({ height: 1200 });
});

it.each([40000, Number.POSITIVE_INFINITY])('rejects an unsafe complete height of %s instead of clipping', async height => {
  const live = source();
  await expect(captureImage(live, { format: 'png', backgroundColor: '#fff', fullHeight: true,
    prepareClone: clone => dimensions(clone, 710, height),
  })).rejects.toThrow();
  expect(toPng).not.toHaveBeenCalled();
  expect(document.body.children).toHaveLength(1);
});

it('reduces pixel ratio to respect the total pixel area budget', async () => {
  await captureImage(source(), { format: 'png', backgroundColor: '#fff', fullHeight: true,
    prepareClone: clone => dimensions(clone, 8000, 8000),
  });
  expect(vi.mocked(toPng).mock.calls[0][1]?.pixelRatio).toBe(1);
});

it.each(['prepare', 'fonts', 'decode', 'capture', 'fetch'] as const)('cleans up without mutating the source on %s failure', async stage => {
  const live = source();
  live.appendChild(document.createElement('img'));
  const original = live.outerHTML;
  const failure = new Error(`${stage} failed`);
  if (stage === 'fonts') Object.defineProperty(document, 'fonts', {
    configurable: true, value: { get ready() { throw failure; } },
  });
  if (stage === 'capture') vi.mocked(toPng).mockRejectedValue(failure);
  if (stage === 'fetch') vi.mocked(fetch).mockRejectedValue(failure);
  await expect(captureImage(live, { format: 'png', backgroundColor: '#fff', prepareClone: clone => {
    if (stage === 'prepare') throw failure;
    if (stage === 'decode') Object.defineProperty(clone.querySelector('img'), 'decode', {
      value: () => Promise.reject(failure),
    });
  } })).rejects.toThrow(failure);
  expect(live.outerHTML).toBe(original);
  expect(document.body.children).toHaveLength(1);
});

it('uses a positive default width when layout is unavailable', async () => {
  const live = source();
  live.style.width = '';
  await captureImage(live, { format: 'png', backgroundColor: '#fff' });
  expect(vi.mocked(toPng).mock.calls[0][0].style.width).toBe('710px');
});
