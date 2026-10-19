const themeNames = { paper: '纸白', white: '纯白', night: '夜色' };
const themeImage = document.getElementById('theme-image');
const caption = document.getElementById('theme-caption');
for (const button of document.querySelectorAll('[data-theme]')) {
  button.addEventListener('click', () => {
    const theme = button.dataset.theme;
    for (const option of document.querySelectorAll('[data-theme]')) option.setAttribute('aria-pressed', String(option === button));
    themeImage.src = `./assets/${theme === 'paper' ? 'writing' : theme}.png`;
    themeImage.alt = `Silens ${themeNames[theme]}主题实际界面`;
    caption.textContent = `正在预览：${themeNames[theme]}主题`;
  });
}

const writing = document.querySelector('.writing-showcase');
const writingCaption = document.getElementById('writing-caption');
const line = document.getElementById('demo-line');
const play = document.getElementById('writing-play');
const paper = document.querySelector('.demo-paper');
const previous = document.querySelector('.demo-previous');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const writingDescriptions = {
  follow: '继续写时，当前行跟随到窗口上方约三分之一处；主动滚动时，让你自由阅读。',
  immersive: '输入时，标题、字数与设置入口淡出；停笔约两秒，界面再轻轻回来。',
  focus: '开启“一期一会”，当前句保持清晰，周围文字变淡、虚化。移鼠可暂时看清全文。',
};
let typingTimer;
let restoreTimer;
let animation;
let sentenceIndex = 0;
const sentences = ['不必追赶屏幕，只管慢慢往下写。', '留一点空白，让新的念头长出来。', '把注意力，留给正在写的这一句。'];
function stopWritingDemo() {
  window.clearInterval(typingTimer);
  window.clearTimeout(restoreTimer);
  animation?.cancel();
  delete writing.dataset.playing;
  play.disabled = false;
  play.textContent = '演示继续书写 ↵';
}
for (const button of document.querySelectorAll('[data-writing]')) {
  button.addEventListener('click', () => {
    stopWritingDemo();
    writing.dataset.mode = button.dataset.writing;
    for (const option of document.querySelectorAll('[data-writing]')) option.setAttribute('aria-pressed', String(option === button));
    writingCaption.textContent = writingDescriptions[button.dataset.writing];
  });
}
play.addEventListener('click', () => {
  stopWritingDemo();
  const sentence = sentences[sentenceIndex++ % sentences.length];
  previous.textContent = line.textContent;
  const finish = () => {
    window.clearInterval(typingTimer);
    play.disabled = false;
    play.textContent = '再写一句 ↵';
    restoreTimer = window.setTimeout(() => { delete writing.dataset.playing; }, 2200);
  };
  if (motionPreference.matches) {
    line.textContent = sentence;
    finish();
    return;
  }
  writing.dataset.playing = 'true';
  play.disabled = true;
  play.textContent = '正在书写…';
  line.textContent = '';
  animation = paper.animate([{ transform: 'translateY(30px)' }, { transform: 'translateY(0)' }], { duration: 650, easing: 'ease-out' });
  let index = 0;
  typingTimer = window.setInterval(() => {
    line.textContent = sentence.slice(0, ++index);
    if (index >= sentence.length) finish();
  }, 65);
});
motionPreference.addEventListener('change', () => { stopWritingDemo(); });

const recallDescriptions = {
  timeline: ['时间轴回顾', '侧栏按日期展示笔记内容'],
  tags: ['标签回顾', '同一标签下的内容块按日期排列'],
  search: ['搜索与上下文', '搜索结果旁展示相关段落预览'],
  links: ['反向链接', '正文下方折叠显示引用来源与片段'],
};
for (const button of document.querySelectorAll('[data-recall]')) {
  button.addEventListener('click', () => {
    const feature = button.dataset.recall;
    const [name, description] = recallDescriptions[feature];
    for (const option of document.querySelectorAll('[data-recall]')) option.setAttribute('aria-pressed', String(option === button));
    const image = document.getElementById('recall-image');
    image.src = `./assets/${feature}.png`;
    image.height = { timeline: 730, tags: 730, search: 560, links: 580 }[feature];
    image.alt = `Silens ${name}实际界面：${description}`;
    document.getElementById('recall-caption').textContent = `实际界面 · ${name} · 示例笔记`;
  });
}

const status = document.getElementById('release-status');
const downloadPatterns = {
  mac: /_aarch64\.dmg$/i,
  windows: /_x64-setup\.exe$/i,
  linux: /_amd64\.AppImage$/i,
};

async function loadDownloads() {
  try {
    const response = await fetch('https://api.github.com/repos/weihus/Silens/releases/latest', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Release unavailable');
    const release = await response.json();
    if (!Array.isArray(release.assets) || typeof release.tag_name !== 'string') throw new Error('Invalid release');
    for (const link of document.querySelectorAll('[data-platform]')) {
      const asset = release.assets.find(item => downloadPatterns[link.dataset.platform].test(item.name));
      if (!asset) continue;
      const url = new URL(asset.browser_download_url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/weihus/Silens/releases/download/')) continue;
      link.href = url.href;
    }
    status.textContent = `${release.tag_name} · 安装包来自 Silens 官方 GitHub Releases`;
  } catch {
    status.textContent = '点击对应平台前往 GitHub Releases，选择安装包下载。';
  }
}
void loadDownloads();
