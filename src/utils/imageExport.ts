export type ImageFormat = 'png' | 'jpg';

export interface CaptureImageOptions {
  format: ImageFormat;
  backgroundColor: string;
  color?: string;
  fullHeight?: boolean;
  prepareClone?: (element: HTMLElement) => void;
}

const MAX_SIDE = 16384;
const MAX_PIXELS = 64_000_000;
const inheritedProperties = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'font-variant', 'font-feature-settings', 'font-variation-settings',
  'line-height', 'letter-spacing', 'word-spacing', 'color', 'text-align',
  'text-indent', 'text-transform', 'white-space', 'word-break',
  'overflow-wrap', 'direction', 'writing-mode', 'tab-size',
];

function copyInheritedStyle(source: Element, target: HTMLElement | SVGElement) {
  const computed = source.ownerDocument.defaultView!.getComputedStyle(source);
  for (const property of inheritedProperties) {
    const value = computed.getPropertyValue(property);
    if (value) target.style.setProperty(property, value);
  }
  for (let index = 0; index < computed.length; index++) {
    const property = computed.item(index);
    if (property.startsWith('--')) target.style.setProperty(property, computed.getPropertyValue(property));
  }
}

function positiveDimension(values: number[], fallback: number): number {
  if (values.some(value => !Number.isFinite(value))) {
    throw new Error('Image dimensions must be finite');
  }
  return Math.ceil(Math.max(fallback, ...values));
}

/** Freeze immediately; only the independent, mounted snapshot survives asynchronous work. */
export async function captureImage(source: HTMLElement, options: CaptureImageOptions): Promise<Uint8Array> {
  const doc = source.ownerDocument;
  const clone = source.cloneNode(true) as HTMLElement;
  const mount = doc.createElement('div');
  try {
    const bounds = source.getBoundingClientRect();
    const computed = doc.defaultView!.getComputedStyle(source);
    const cssWidth = Number.parseFloat(computed.width);
    const width = positiveDimension([bounds.width, source.offsetWidth], 0)
      || (Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : 710);
    const sourceHeight = positiveDimension([bounds.height, source.scrollHeight, source.offsetHeight], 1);

    // Resolve ancestor inheritance before moving the snapshot outside its theme/editor containers.
    const ancestors: Element[] = [];
    for (let ancestor = source.parentElement; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor);
    for (const ancestor of ancestors) copyInheritedStyle(ancestor, clone);
    copyInheritedStyle(source, clone);
    const originals = source.querySelectorAll('*');
    const copies = clone.querySelectorAll('*');
    originals.forEach((original, index) => {
      const copy = copies[index];
      if (copy instanceof HTMLElement || copy instanceof SVGElement) copyInheritedStyle(original, copy);
    });

    clone.setAttribute('data-image-export-snapshot', '');
    clone.style.width = `${width}px`;
    clone.style.boxSizing = 'border-box';
    clone.style.maxWidth = 'none';
    clone.style.minWidth = '0';
    if (options.color !== undefined) clone.style.color = options.color;
    clone.style.backgroundColor = options.backgroundColor;
    mount.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
    mount.style.width = `${width}px`;
    mount.setAttribute('aria-hidden', 'true');
    mount.inert = true;
    mount.appendChild(clone);
    doc.body.appendChild(mount);
    options.prepareClone?.(clone);

    clone.querySelectorAll('[data-export-exclude]').forEach(element => element.remove());
    for (const element of [clone, ...clone.querySelectorAll('*')]) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
      element.style.setProperty('animation', 'none', 'important');
      element.style.setProperty('transition', 'none', 'important');
      element.style.setProperty('opacity', '1', 'important');
      element.style.setProperty('content-visibility', 'visible', 'important');
      if (options.fullHeight && element instanceof HTMLElement && !['IMG', 'VIDEO', 'CANVAS'].includes(element.tagName)) {
        element.style.setProperty('height', 'auto', 'important');
        element.style.setProperty('min-height', '0', 'important');
        element.style.setProperty('max-height', 'none', 'important');
        element.style.setProperty('overflow', 'visible', 'important');
        element.style.setProperty('contain', 'none', 'important');
        element.style.setProperty('flex-shrink', '0', 'important');
      }
    }
    // Position the wrapper offscreen; the captured root itself retains normal document flow.
    clone.style.position = 'static';
    clone.style.left = 'auto';
    clone.style.top = 'auto';

    if (doc.fonts?.ready) await doc.fonts.ready;
    await Promise.all(Array.from(clone.querySelectorAll('img'), async image => {
      if (typeof image.decode === 'function') await image.decode();
    }));

    const measured = clone.getBoundingClientRect();
    const captureWidth = positiveDimension([measured.width, clone.scrollWidth, clone.offsetWidth], width);
    const captureHeight = positiveDimension([measured.height, clone.scrollHeight, clone.offsetHeight],
      measured.height > 0 || clone.scrollHeight > 0 ? 1 : sourceHeight);
    const pixelRatio = Math.min(2, MAX_SIDE / captureWidth, MAX_SIDE / captureHeight,
      Math.sqrt(MAX_PIXELS / captureWidth / captureHeight));
    if (!Number.isFinite(pixelRatio) || pixelRatio < 0.5) {
      throw new Error('Image is too large to export completely; choose a shorter range');
    }
    const { toPng, toJpeg } = await import('html-to-image');
    const capture = options.format === 'png' ? toPng : toJpeg;
    const dataUrl = await capture(clone, {
      quality: 0.95,
      pixelRatio,
      backgroundColor: options.backgroundColor,
      style: { position: 'static', left: 'auto', top: 'auto' },
      ...(options.fullHeight ? { width: captureWidth, height: captureHeight } : {}),
    });
    const blob = await fetch(dataUrl).then(response => response.blob());
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    mount.remove();
  }
}
