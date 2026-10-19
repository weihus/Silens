import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '*,*::before,*::after{animation:none !important;transition:none !important;caret-color:transparent !important}' });

await page.evaluate(() => {
  const prose = document.querySelector('.ProseMirror');
  if (!prose.editor) throw new Error('editor not found');
  prose.editor.commands.setContent([
    '留一点空白，让一个念头慢慢长出来。',
    '',
    '先写眼前这一句，其他的事，可以等一等。',
    '',
    '也许，安静不是没有声音，而是终于听见了自己。',
  ].join('\n'), { emitUpdate: false });
  const title = [...document.querySelectorAll('span')].find(s => s.textContent === '正在打开笔记');
  if (title) title.textContent = '灵感';
  document.querySelector('[role="alert"]')?.remove();
  document.querySelector('.canvas-loading')?.remove();
  document.querySelector('[aria-hidden="true"].pointer-events-none.absolute')?.remove();
});
await page.waitForTimeout(300);

await page.evaluate(() => {
  const prose = document.querySelector('.ProseMirror');
  prose.style.minHeight = '0';
  const area = document.querySelector('.canvas-writing-area');
  const section = document.createElement('section');
  section.setAttribute('aria-label', '反向链接');
  section.className = 'w-full max-w-[620px] mx-auto px-[40px] mt-12 text-sm';
  section.style.color = 'var(--theme-muted)';
  section.innerHTML = `
    <details class="border-t pt-4" open style="border-color: var(--theme-border)">
      <summary class="cursor-pointer py-2">被 2 篇笔记引用</summary>
      <ul class="mt-2 space-y-1">
        <li><button class="quiet-button w-full rounded-lg px-3 py-3 text-left">
          <span class="block break-all" style="color: var(--theme-text)">2026-10-18</span>
          <span class="mt-1 block leading-relaxed break-words">有些句子当时没写完，却在 [[灵感]] 里悄悄接上了。</span>
        </button></li>
        <li><button class="quiet-button w-full rounded-lg px-3 py-3 text-left">
          <span class="block break-all" style="color: var(--theme-text)">2026-10-17</span>
          <span class="mt-1 block leading-relaxed break-words">回头看 [[灵感.md]]，那些没有急着说完的，都可以在这里继续。</span>
        </button></li>
      </ul>
    </details>`;
  area.insertBefore(section, area.lastElementChild);

  const scroller = document.getElementById('silens-scroll-container');
  const paragraphs = prose.querySelectorAll('p');
  const last = paragraphs[paragraphs.length - 1];
  scroller.scrollTop = 0;
  scroller.scrollTop = Math.max(0, last.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 170);
  document.querySelectorAll('[aria-hidden="true"]').forEach(el => {
    if ((el.getAttribute('class') || '').includes('absolute')) el.remove();
  });
});
await page.waitForTimeout(400);

const frame = await page.evaluate(() => {
  const prose = document.querySelector('.ProseMirror');
  const paragraphs = prose.querySelectorAll('p');
  const last = paragraphs[paragraphs.length - 1];
  const section = document.querySelector('[aria-label="反向链接"]');
  const lastRect = last.getBoundingClientRect();
  const sectionRect = section.getBoundingClientRect();
  const areaRect = document.querySelector('.canvas-writing-area').parentElement.getBoundingClientRect();
  const width = 600;
  return {
    contentTop: Math.round(lastRect.top),
    contentBottom: Math.round(sectionRect.bottom),
    contentHeight: Math.round(sectionRect.bottom - lastRect.top),
    clip: {
      x: Math.round(areaRect.left + (areaRect.width - width) / 2),
      y: Math.round(lastRect.top - 6),
      width,
      height: 290,
    },
  };
});
console.log('FRAME:', JSON.stringify(frame));

await page.screenshot({ path: 'website/assets/links.png', clip: frame.clip });
await browser.close();
console.log('saved', JSON.stringify(frame.clip));
