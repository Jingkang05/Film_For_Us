"""Build the owner-supplied FontQu Smile webfonts; requires fonttools[woff].
Run: python scripts/build-handwriting-fonts.py [source.ttf]
Only outlines of U+FF0C and U+3002 are optically centered; text stays unchanged.
"""
import argparse
import statistics
from pathlib import Path
from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / 'public/fonts'
RANGES = [(0x2E80, 0x9FFF), (0xF900, 0xFAFF), (0xFE10, 0xFE1F),
          (0xFE30, 0xFE4F), (0xFF01, 0xFF60), (0xFFE0, 0xFFE6), (0x20000, 0x323AF)]
MARKS = {0xFF0C, 0x3002}

def save(font, points, filename, family):
    options = subset.Options()
    options.recalc_timestamp = False
    options.name_IDs = ['*']
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=points)
    worker.subset(font)
    for record in font['name'].names:
        values = {1: family, 4: family + ' Regular', 6: family.replace(' ', '') + '-Regular'}
        if record.nameID in values:
            record.string = values[record.nameID].encode(record.getEncoding())
    font.flavor = 'woff2'
    font.save(FONTS / filename)
    print(filename, len(points), (FONTS / filename).stat().st_size)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path, default=FONTS/'custom-chinese.ttf')
    source = parser.parse_args().source
    font = TTFont(source)
    if font['OS/2'].fsType & (2 | 0x100 | 0x200):
        raise ValueError('Font embedding or subsetting flags prohibit this build')
    points = {cp for cp in font.getBestCmap() if any(a <= cp <= b for a,b in RANGES)}
    FONTS.mkdir(exist_ok=True)
    save(font, points - MARKS, 'custom-chinese-cjk.woff2', 'Roll Custom Chinese')
    marks = TTFont(source)
    glyphs = marks.getGlyphSet()
    cmap = marks.getBestCmap()
    def center(cp):
        pen = BoundsPen(glyphs)
        glyphs[cmap[cp]].draw(pen)
        return (pen.bounds[1] + pen.bounds[3]) / 2
    target = statistics.median(center(ord(c)) for c in '中文书信你好我们照片时光温柔若雪开心回忆喜欢')
    for cp in sorted(MARKS):
        delta = round(target - center(cp))
        name = cmap[cp]
        pen = TTGlyphPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (1,0,0,1,0,delta)))
        marks['glyf'][name] = pen.glyph()
        print(f'U+{cp:X} lift {delta / marks["head"].unitsPerEm:.4f}em ({delta} units)')
    save(marks, MARKS, 'custom-chinese-punctuation.woff2', 'Roll Custom Chinese Marks')
    ranges = ','.join(f'U+{a:X}-{b:X}' for a,b in RANGES)
    # Separate punctuation ranges prevent duplicate fetching/overlapping faces.
    ranges = ranges.replace('U+2E80-9FFF','U+2E80-3001,U+3003-9FFF').replace('U+FF01-FF60','U+FF01-FF0B,U+FF0D-FF60')
    css = ['/* Generated from the owner-supplied TTF. Latin retains existing fonts. */']
    for file, coverage in [('custom-chinese-cjk.woff2',ranges), ('custom-chinese-punctuation.woff2','U+FF0C,U+3002')]:
        for style in ['normal','italic']:
            css.append(f'''@font-face {{
  font-family: "CustomChineseHandwriting";
  src: url("/fonts/{file}") format("woff2");
  font-style: {style};
  font-weight: 100 900;
  font-display: swap;
  size-adjust: 125%;
  unicode-range: {coverage};
}}''')
    (ROOT/'public/typography.css').write_text('\n'.join(css)+'\n')

if __name__ == '__main__':
    main()
