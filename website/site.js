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
