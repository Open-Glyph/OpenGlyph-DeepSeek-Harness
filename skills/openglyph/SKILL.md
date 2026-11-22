---
name: openglyph
description: OpenGlyph统一入口：环境自检、古文字图像框字与检索、隶定字结构造字、现有字库与新字混排、LaTeX论文项目和PDF编译。用于古文字证据及排印，不把通用OCR当核定。
---

# 古文字证据与排印

## 统一入口与首次自检

用户输入 `/openglyph` 就会加载这份完整流程；不要要求用户分别手工调用每个工具。若用户只输入技能名而未给任务，先调用 `gwz_check`，简要报告哪些能力可用、缺什么，再等待用户给文件或排版需求；不自动扫描工作文件夹、处理整本书或启动付费模型测试。

原生工具随插件启用就已经注册，技能负责操作指导。首次云端检索需要用户自己的CLI登录；纯本地已有字排印不要求云账号。`gwz_latex_setup` 检查编译器和本地依赖，`install_dependencies=true` 只在工作文件夹中创建独立Python环境，不改全局环境。缺编译器时清楚报出安装/路径设置，不假称完整就绪。

## 真正排论文，不只交付ZIP

需要论文PDF时，使用 `gwz_latex_prepare(project_dir=新目录)`。它会把真实 `openglyph.sty`、22,583字OTF和catalog放进项目，并返回可编辑的 `main.tex`。不要要求用户另找LaTeX仓库。若先前已由 `gwz_deliver` 得到字体ZIP，可作为 `font_bundle` 导入，自动载入新字目录。

已存在论文则保留用户原稿，确认项目已经有宏包与字体，不重复新建/覆盖；用DSH文件工具编辑指定 `.tex`。

最小排印语法必须直接使用：

```tex
\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage{openglyph}
\OpenGlyphLoad{ebag}
\begin{document}
已有码字形：\ebag{s030-067}。
\end{document}
```

用 `gwz_latex_lookup` 查实际编号和现成排印命令，不能猜 `ebag` 编号。新造字先 `\OpenGlyphLoad{myglyphs}`，再 `\gwglyph{my:n1}`，与正常汉字穿插写入正文。命令中的编号是ASCII来源/别名，不是学术释读，不需要先打出生僻字。

写好源码后**调用 `gwz_latex_compile(tex_file=实际文件路径)`**，这一步才会真的生成PDF。用Tectonic/XeLaTeX，不用pdfLaTeX、不启用shell-escape。检查返回的缺字、未知编号、溢出、页数和字体嵌入报告。出错就根据完整日志修复相关源码/字库，再编译；不重复同样失败步骤，不拿旧PDF冒充新结果。未执行编译就不能声称“已排好论文”。编译成功也不代表字形/学术释读已由人核定。

更多本地新字JSON、源码、已有/自造字混排示例见 [LaTeX完整操作](references/latex.md)。

本环境已经把工具注册为 gwz_* 原生调用，不必先自己研究终端命令。用 gwz_catalog 查看某个工具完整输入、输出说明与示例；用 gwz_check 检查用户现有 CLI 登录。

## 文献与字图

用 gwz_open 登记用户指定文件，再取指定物理页的 gwz_page_prepare(detail=image)。默认不做版面模型、不搜索书中其他释文页。用 gwz_glyph_detect 取得灰度原图的检测框、原字裁图和全部候选图页。字形图片的 asset_id、文档 document_id、页码和原像素 bbox 不能互换。

普通解释可以轻量阅读。忠实转写和排印则需要逐个差异字形的实际证据，尤其是用户已经指出选错字的情况。看全部相关候选图页，记录漏检、残片、饰笔；不要把检测结果直接当作 OCR 读法。

## 从图找到能编辑的底字

原字图 → gwz_glyph_template_search → 查看候选图与其 program → gwz_glyph_template_inspect。

检索 whole glyph 是找底字，scope=component 是找部件。inspect 返回真实编号 node、部件图和可供选择的修改建议。修改只针对这些实际编号；根节点和子部件需要逐层展开。不要把 r0 等记录编号猜成某种语义笔画。

需要全图库来源和异体时用 gwz_glyph_search，查看真实候选后再 glyph_select；其绑定和 gwz 身份仍不等于学术释读。没有匹配可以 glyph_register 保存原图，但这一步不会生成字体。

离线已有字库可用 `gwz_latex_lookup` → `gwz_latex_inspect` 查实际部件编号。离线新字项目用 `gwz_latex_build`；有账号时图像检索及原图比较仍优先使用已部署的专用工具。两种构字来源最终都能接进同一个LaTeX项目。

## 从缺字到可打印字体

找到吻合的整字就复用；没有整字就复用相近模板和部件，以返回的 JSON program 调整、替换、插入或删除。glyph_compose 支持 program、原图绑定 proposal_id、glyph，也保留 ids 与 structure，两条路线并行；优先可以导出 LaTeX 项目的模板方案。不要编写 raw KAGE 或把相近常用字当作目标字。

供熟悉 API 的调用者参考，实际可用模板示例：

```json
{"program":{"schema":"guwenzi.template-program.v1","base":"ebag:s030-067","edits":[]}}
```

这段只是复用一个底字。真正遇到新形时，必须先 inspect 并看图，再根据实际 node 和原图确定 edits；不能把这个示例误当作所有新字的答案。更详细的模块与编辑调用见 [结构造字示例](references/composition.md)。

glyph_compose 的 print_font.status=ready 才有可下载字体；把 glyphs[].codepoint 与随附 OTF/TTF、mapping 一起使用。多个单字字体可能各自用 U+E000，不能直接拼接；批量 compose 返回的合并字体才处理了冲突。PUA 是字体局部地址，不是官方身份。不能凭看起来像就填写 unicode_codepoint。

## 核对与交付

将每个原打印字图与实际最终字体码位交给 gwz_glyph_verify；直接检查差分，不用 DINO 分数充当验收。needs_review 时保留可打印候选稿和具体待核说明，交给人确认。输出字体可用不意味着原型字释读或字形准确已经得到确认。

用 gwz_deliver 保存可复制文字、OTF/TTF、码位映射、嵌入字体 Word 与 LaTeX 包。它只整理实际已有的造字结果，不伪造确认记录。中间证据在 work，最终成果在 outputs；不要把几十张中间字图当作交付文件。

gwz_transcribe 只保存已经读出的分段文本。竖排阅读顺序与原形/隶定的逐字对应另用 reading_plan 保存，不能以行数或位置相近取代字形核对。完整候选保存在 full_json；列表或图片有 next_offset 时，用 gwz_evidence 继续看。


## OpenGlyph-OCR-IDS 识别与排印

需要机器识别初稿时，先检查实时工具中有 `text_read`。外部 CLI 0.7+ 可直接：

```sh
guwenzi-tools ocr input.png --layout lines --second-options --output outputs/ocr
# 竖排加 --writing-mode vertical-rl；整面用 --layout page（无 IDS 拼写器/第二候选）
guwenzi-tools ocr --resume --output outputs/ocr
```

`result.json` 保留完整回执、原图框、逐行文字、备选与模型版本，`text.txt` 是原始标记文本。正文的普通 Unicode、`<gw:精确名称>`、`<ids>嵌套结构</ids>` 必须保留，不输出模型内部 token 编号，不删标签、不做 Unicode 规范化或繁简转换，不将第二候选自动替换正文。`complete=false` 表示未完整识别；机器初稿不等于学术核定。

OpenGlyph-LaTeX 0.3+ 的 `python scripts/openglyph.py ocr outputs/ocr/result.json --remote -o outputs/paper` 会通过当前账号合成所需字形，检查正文字体覆盖，并输出字体、别名、原始文字、`main.tex` 和 `body.tex`。普通正文缺字时按原 Unicode 码位补齐；不支持的精确字形/选择符必须明确报出，不能静默换字。依赖 `guwenzi-tools` 和 `fonttools`，TeX 字体首次未缓存时传 `--text-font` 指定 OTF/TTF。随后真实编译 `main.tex`，检查缺字、嵌入字体和原图差异。PDF 中无编码字的复制内容用 ActualText 保留原 GW/IDS 标记，仍需随附字体与映射。

DeepSeek Harness 使用 `gwz_open(kind=image)` → `gwz_text_read` → `gwz_latex_ocr(source_file=full_json, project_dir=新目录)` → `gwz_latex_compile`；不要求用户手工粘贴每个标记。网站托管沙箱仍按实际暴露工具操作，不能安装 CLI 或绕过既有坐标/台账流程。
