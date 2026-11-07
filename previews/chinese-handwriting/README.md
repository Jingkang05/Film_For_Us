# 中文手写字体本地预览

打开 `index.html`，或从项目目录运行：

```sh
python3 -m http.server 4260 --bind 127.0.0.1 --directory previews/chinese-handwriting
```

访问 http://127.0.0.1:4260 。两栏使用相同文案和字号；可以调整字号、切换原生标点与居中标点。标题和正文没有逐字旋转、随机偏移或描边。

字体由用户提供，转换为 WOFF2，保留原始字形、字距及字体元数据；本目录是独立预览，没有接入项目主页。相片取自项目现有 `public/samples/home-3.webp`。

| 位置 | 字体 | 原始文件 | 字符覆盖 |
| --- | --- | --- | --- |
| 左 | 克莱因蓝的夜晚 | `KeLaiYinLanDeYeWan-2.ttf` | 22,050 个映射字符；本页全部示例均覆盖 |
| 右 | 寄给冬天的情诗 | `JiGeiDongTianDeQingShi-2.ttf` | 7,254 个映射字符；本页简体示例均覆盖，缺少「記、憶、歲、溫」等部分繁体字 |

中文逗号、句号仍是原本 Unicode 字符，以无障碍的行内 `span` 包裹，使用 `position: relative; top: …em` 调整视觉位置。两款字体的逗号、句号分别校准，关闭复选框即可看原生位置。不改变文本、复制内容和布局中的字符宽度。

授权信息：第一款字体内部名称为 `AaKLYLDYW (Non-Commercial Use)`，版权属于 HanMeiHutong (XiaMen) Technology Co.Ltd.；第二款内部名称为 `JGDTDQS`，没有提供明确的网页嵌入许可文本。本次仅作用户要求的本地预览，不代表已经取得正式网站使用授权。
