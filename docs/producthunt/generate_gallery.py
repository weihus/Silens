from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
S = 2
W, H = 1270, 760
PAPER = '#F6F3EC'
INK = '#263B33'
MUTED = '#58675E'
GREEN = '#718B73'
FONTS = Path('/System/Library/Fonts/Supplemental')


def font(size, style='regular'):
    names = {'regular': 'Arial.ttf', 'bold': 'Arial Bold.ttf', 'serif': 'Georgia.ttf'}
    return ImageFont.truetype(str(FONTS / names[style]), round(size * S))


def text(im, xy, value, size=20, fill=INK, style='regular'):
    ImageDraw.Draw(im).text(tuple(round(v * S) for v in xy), value, font=font(size, style), fill=fill)


def rect(im, box, fill, radius=0, outline=None):
    ImageDraw.Draw(im).rounded_rectangle(tuple(round(v * S) for v in box), radius=round(radius * S), fill=fill, outline=outline, width=S)


def base(n, dark=False):
    im = Image.new('RGB', (W * S, H * S), '#17221D' if dark else PAPER)
    icon = Image.open(ROOT / 'src-tauri/icons/icon.png').convert('RGBA').resize((72, 72), Image.Resampling.LANCZOS)
    im.paste(icon, (136, 72), icon)
    text(im, (114, 43), 'Silens', 23, '#F2F1EA' if dark else INK, 'bold')
    text(im, (1045, 48), f'{n:02d} / 06', 15, '#A8B8AC' if dark else MUTED)
    return im


def screenshot(im, name, x, y, width):
    source = Image.open(ROOT / 'website/assets' / f'{name}.png').convert('RGB')
    height = width * source.height / source.width
    box = (x, y, x + width, y + height + 27)
    shadow = Image.new('RGBA', im.size)
    ImageDraw.Draw(shadow).rounded_rectangle(tuple(round(v * S) for v in (x, y + 10, x + width, y + height + 40)), radius=14 * S, fill=(26, 47, 34, 35))
    im.paste(Image.alpha_composite(im.convert('RGBA'), shadow.filter(ImageFilter.GaussianBlur(17 * S))).convert('RGB'))
    frame = Image.new('RGB', (round(width * S), round((height + 27) * S)), '#EDEBE5')
    draw = ImageDraw.Draw(frame)
    for i, color in enumerate(['#C8B7AC', '#D5C7A7', '#B6C4B0']):
        px = (14 + i * 14) * S
        draw.ellipse((px, 10 * S, px + 7 * S, 17 * S), fill=color)
    source = source.resize((round(width * S), round(height * S)), Image.Resampling.LANCZOS)
    frame.paste(source, (0, 27 * S))
    mask = Image.new('L', frame.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, frame.width - 1, frame.height - 1), radius=11 * S, fill=255)
    im.paste(frame, (round(x * S), round(y * S)), mask)
    ImageDraw.Draw(im).rounded_rectangle(tuple(round(v * S) for v in box), radius=11 * S, outline='#D5DCD1', width=S)
    return height + 27


def save(im, name):
    im.save(OUT / name, optimize=True)


im = base(1)
text(im, (76, 158), 'A quiet place', 54, style='serif')
text(im, (76, 225), 'for your', 54, style='serif')
text(im, (76, 292), 'words.', 54, style='serif')
text(im, (78, 392), 'Local-first Markdown writing.', 23)
text(im, (78, 430), 'Less noise. More room to think.', 21, MUTED)
screenshot(im, 'writing', 596, 164, 598)
rect(im, (76, 528, 471, 572), '#E5EBE0', 22)
text(im, (96, 540), 'Free & open source  /  No account', 17)
text(im, (78, 621), 'Your notes. Your Markdown files.', 18, MUTED)
text(im, (78, 660), 'macOS  /  Windows  /  Linux', 17, MUTED)
save(im, '01-cover.png')

im = base(2)
text(im, (76, 108), 'One sentence. Your full attention.', 46, style='serif')
text(im, (78, 176), 'Sentence focus softens the surrounding text so your next thought has room.', 21, MUTED)
screenshot(im, 'focus', 105, 222, 1060)
text(im, (80, 713), 'Sentence focus  /  Focus timer  /  Typewriter scrolling', 17, MUTED)
save(im, '02-focus.png')

im = base(3)
text(im, (76, 112), 'Find your way back to an idea.', 46, style='serif')
text(im, (78, 180), 'A timeline for your days. Tags for the thoughts that connect them.', 21, MUTED)
text(im, (80, 309), 'Follow the timeline', 25, style='bold')
text(im, (80, 352), 'Return to earlier entries', 20, MUTED)
text(im, (80, 382), 'without leaving your writing.', 20, MUTED)
rect(im, (80, 444, 378, 445), '#D4DCCD')
text(im, (80, 484), 'Leave a little structure', 25, style='bold')
text(im, (80, 527), 'Use #tags and [[wiki links]]', 20, MUTED)
text(im, (80, 557), 'to reconnect your notes.', 20, MUTED)
screenshot(im, 'timeline', 455, 240, 740)
text(im, (80, 713), 'Timeline  /  Tags  /  Wiki links', 17, MUTED)
save(im, '03-rediscover.png')

im = base(4)
text(im, (76, 108), 'Follow the thread.', 46, style='serif')
text(im, (78, 176), 'Type [[ to link notes together. Backlinks quietly show who references this one.', 21, MUTED)
screenshot(im, 'links', 160, 222, 950)
text(im, (80, 713), 'Wiki links  /  Backlinks  /  Jump back to the source', 17, MUTED)
save(im, '04-connections.png')

im = base(5)
text(im, (76, 108), 'Find the thought. See the context.', 46, style='serif')
text(im, (78, 176), 'Search your local notes, preview the surrounding words, and return to the original.', 21, MUTED)
screenshot(im, 'search', 160, 222, 950)
text(im, (80, 713), 'Local search  /  Context previews  /  Cmd or Ctrl + K', 17, MUTED)
save(im, '05-search.png')

im = base(6, dark=True)
text(im, (76, 109), 'Make yourself at home.', 49, '#F4F1E9', 'serif')
text(im, (78, 181), 'Warm paper, white, or night. Add rain, fire, or night sounds to settle in.', 21, '#BAC6BA')
text(im, (80, 248), 'WARM PAPER', 14, '#BCCBBE', 'bold')
text(im, (660, 248), 'NIGHT', 14, '#BCCBBE', 'bold')
screenshot(im, 'writing', 80, 284, 530)
screenshot(im, 'night', 660, 284, 530)
text(im, (80, 713), 'Three themes  /  Ambient sounds  /  Offline writing', 17, '#BAC6BA')
save(im, '06-atmosphere.png')

thumbs = []
for p in sorted(OUT.glob('0*.png')):
    image = Image.open(p)
    assert image.size == (2540, 1520), (p, image.size)
    tile = Image.new('RGB', (635, 410), '#FFFFFF')
    tile.paste(image.resize((635, 380), Image.Resampling.LANCZOS), (0, 0))
    ImageDraw.Draw(tile).text((12, 385), p.name, font=ImageFont.truetype(str(FONTS / 'Arial.ttf'), 15), fill=INK)
    thumbs.append(tile)
contact = Image.new('RGB', (1270, 1230), '#E8E7E0')
for i, tile in enumerate(thumbs):
    contact.paste(tile, ((i % 2) * 635, (i // 2) * 410))
contact.save(OUT / 'gallery-preview.jpg', quality=92)
print('\n'.join(f'{p.name}: {p.stat().st_size / 1024:.0f} KB' for p in sorted(OUT.glob('0*.png'))))
