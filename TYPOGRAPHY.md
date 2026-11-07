# 中文手写字体系统

中文采用用户选择并提供的 **寄给冬天的情诗**（内部名称 `JGDTDQS`，Version 1.00），由 `JiGeiDongTianDeQingShi-2.ttf` 构建本地 WOFF2。字形保持原样，不做随机旋转、位移、描边、发光或动画抖动。英文仍使用 Cormorant Garamond、Courier Prime、Reenie Beanie 和原有系统界面字体。

## 资源与覆盖

| 文件 | 用途 |
| --- | --- |
| `public/assets/winter-poem-cjk.woff2` | 原字体的 7,013 个中文、全角及 CJK 符号映射，不含单独校准的两个标点 |
| `public/assets/winter-poem-punctuation.woff2` | 保留原 Unicode 与字宽的中文逗号、句号 |
| `public/assets/jason7-cjk-fallback.woff2` | 仅补足主字体未收录的 4,202 个 CJK 字符，按需载入 |
| `public/typography.css` | 由字体构建脚本生成的 `@font-face` 及 `unicode-range` |

使用完整中文字库而非按当前文案截取，所以新增用户输入无需重新构建。主字体没有完整繁体覆盖，例如「記、憶、歲、溫」需要回退；不能让原文件不存在的字形呈现为这款字体。回退使用游清松的 **清松手写体 7p**，仍为自然手写风格。极少数两款字库都没有的字由浏览器兜底。

清松 7p 来源：[作者仓库](https://github.com/jasonhandwriting/JasonHandwriting)，版本 1.01；SIL OFL 1.1 许可见 `public/assets/jason7-OFL.txt`。

用户提供的主字体没有随附明确的网页嵌入授权文本，文件的 `fsType=0` 仅为技术标志，不等同于法律许可。本次完成本地项目集成；未验证正式网站发布所需的授权，也没有部署网站。

主字体原始文件 SHA-256：`98270a6c9b729faaeebf113161e5c7d028b9e04b4a3b3f99e520d9008a2d1e67`。

## 排版层级

`public/darkroom.css` 定义 `--font-zh-title`、`--font-zh-body`、`--font-zh-caption`，当前统一指向所选字体。它们加入所有字体栈的首位，但 `unicode-range` 排除了 ASCII，因此不接管英文和数字。

- 主标题：35.2–60 px、1.4 行高、`.015em` 字距；依靠原字体字形表现力。
- 中文信件：19.2–22.4 px、1.95 行高、`.025em` 字距。
- 照片背面文字：19.2–23.2 px、1.9 行高。
- 拍立得正面：按卡片宽度响应，约 13.1–19.2 px、1.42 行高、`.01em` 字距；深棕墨色 `#573b2d`。
- 拍立得放大题注：18.4–24.8 px、1.7 行高、`.01em` 字距，保留用户换行。
- 编辑器：中文输入字段 19.2 px、1.75 行高；输入、预览和最终展示均使用同一字体。

`src/typography.ts` 只检测是否包含汉字，设置 `data-cjk` 与 `lang="zh"` 以应用相应字号和行距。用户数据、输入值和 `textContent` 不变，混排时英文与数字保留原字体。字形以同一绘制注册到普通/斜体及字重请求，避免浏览器为中文合成假粗体、假斜体。

## 中文标点

沿用预览中确认的光学校准：逗号 U+FF0C 上移 `.38em`，句号 U+3002 上移 `.35em`。构建脚本以 `em × unitsPerEm` 转成字体坐标，生成独立的双字符 WOFF2，原字体的其他字形不变。

这与预览的 CSS 相对上移在视觉上等效，但无需包裹字符；因此在原生 `input`、`textarea`、`select`、动态 `textContent` 和任何后续框架渲染中同样生效。保留 Unicode、advance width 与文字换行规则；复制、IME 输入、屏幕阅读器不受字符替换影响。引号、感叹号和问号没有人为拉伸或移位。

## 重新构建

安装 Python `fonttools` 与 `brotli`，然后执行：

```sh
python scripts/build-handwriting-fonts.py /path/to/JiGeiDongTianDeQingShi-2.ttf /path/to/JasonHandwriting7p.ttf
pnpm build
```

脚本保留字体版权元数据。标点子集的内部名称改为 `Roll Winter Poem Marks`，明确区分光学校准版本。运行时不依赖外部字体 CDN。

## 修改文件

- `public/index.html`：载入字体样式。
- `public/typography.css`、`public/assets/*cjk*.woff2`、`public/assets/winter-poem-punctuation.woff2`：字体及分字符覆盖。
- `public/darkroom.css`、`public/polaroid.css`、`public/manage.css`：共享 tokens、中文层级、相纸墨色与输入样式。
- `src/typography.ts`、`src/darkroom.ts`、`src/polaroid.ts`、`src/manage.ts`：中文内容属性及输入时的排版更新。
- `server/index.mjs`：允许本地服务器提供新的字体 CSS。
- `scripts/build-handwriting-fonts.py`：可复现的子集及标点构建流程。
- `README.md`、本文件及 `public/assets/*NOTICE.txt` / `jason7-OFL.txt`：使用说明与来源记录。

## 验证记录

- `pnpm check`、`pnpm build` 通过；现有两项集成测试全部通过。
- 验证 7,013 个主字体 CJK 映射：所有字形坐标与 advance width 与用户提供的 TTF 一致。两个标点各自只改变纵坐标，字宽与 Unicode 不变。
- 验证主字体、标点和 4,202 个回退映射互不重叠，ASCII 不在这些网页字体的覆盖范围内。
- 使用隔离的中文测试文案，在项目实际渲染器中检查信件、主标题、胶卷标签、拍立得打印/堆叠及题注弹窗。没有改写实际相册数据或演示文案。
- 浏览器检查桌面 1280 × 900 与手机 390 × 844，含输入框原文保留、中英数字混排及标点。未进行独立的 Chrome / Firefox / Safari 跨浏览器实机矩阵测试。
- 截图保存在 `previews/chinese-handwriting/integrated-*.jpg`。
