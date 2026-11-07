# 中文字体系统

当前唯一中文网页字体为用户提供的 **字制区 喜脉喜欢体**：内部 Family 为 `FontQu Smile 常规`（另一语言记录为 `FontQu Smile __`），PostScript Name 为 `xihuanti`。CSS 统一名称为 `CustomChineseHandwriting`。

## 资源与许可

- `public/fonts/custom-chinese.ttf`：用户提供的原始文件，9,487,176 字节，未修改。
- `public/fonts/custom-chinese-cjk.woff2`：完整保留原字体的 7,534 个 CJK/全角字符映射（两个标点另存），4,165,372 字节；不按当前文案截取，新增用户输入可直接使用。
- `public/fonts/custom-chinese-punctuation.woff2`：两个中文标点，2,556 字节。
- `public/fonts/OFL.txt`：保留原版权及完整 SIL OFL 1.1 许可。原字体 name ID 13 声明 SIL OFL 1.1，OS/2 fsType=8（可编辑嵌入，无禁止子集/仅位图标志）。派生字体内部改名为 `Roll Custom Chinese` / `Roll Custom Chinese Marks`，保留版权和许可元数据。

新字形墨迹较小，使用统一 `size-adjust: 125%` 做中文光学尺寸补偿，不改变轮廓比例或英文排版。仅加载 WOFF2，`font-display: swap`；原始 TTF 用于留档、复现，不预加载。字体按 Unicode 范围选择，ASCII、数字和英文标点不由新字体接管，继续使用原 Cormorant Garamond、Courier Prime、Reenie Beanie。普通/斜体注册使用同一原始绘制，避免中文伪斜体和伪粗体。

字体包含 7,374 个基本区汉字，覆盖所有当前源码与演示文案中的汉字和所检查的常用中文标点。不是完整 Unicode 字库；例如「記、憶、歲、溫、龘、𠮷」缺字时使用浏览器系统回退，不引入另一款中文网页字体。旧 Winter Poem / Jason 字体不再注册或加载。

## 标点重新校准

以新字体中「中文书信你好我们照片时光温柔若雪开心回忆喜欢」的字形边界中线中位数作为视觉中线，分别校准原逗号、句号：

- U+FF0C「，」上移 494/2048 em ≈ **0.2412em**。
- U+3002「。」上移 473/2048 em ≈ **0.2310em**。

这不是旧字体的偏移参数。独立 WOFF2 仅平移这两个轮廓，保留原 Unicode、advance width、其他字符的轮廓和字体度量。无需 DOM 字符包裹或替换，在 textarea/input 中也保持选择、复制、IME 和原始值不变。

## 角色与排版

`public/darkroom.css` 中 `--font-zh`、`--font-zh-display`、`--font-zh-body`、`--font-zh-caption` 均指向这款字体；`--font-zh-title` 作为已有组件的兼容别名。所有已有组件通过共享栈获得新字体。信纸保留 1:1.3、内部滚动、21px 桌面 / 19px 手机中文字号和 1.85 / 1.8 行高。没有修改真实信件、翻译、动画或场景布局。

## 重建

```sh
python scripts/build-handwriting-fonts.py
pnpm check
pnpm build
pnpm test
```

Python 需要 fonttools[woff] 和 Brotli。可选参数为另一份相同来源的原始 TTF 路径。构建脚本保留完整可用 CJK 映射，并重新测量标点位置。
