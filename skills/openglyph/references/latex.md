# LaTeX完整排论文操作

## 环境与入口

`/openglyph` 是统一入口，工具已随插件启用注册。首次自检区分云端检索/造字和本地排印：已有字库与PDF编译不要求云账号；云端工具需要用户自己的CLI登录；本地编译需要Tectonic或XeLaTeX。环境缺失时照 `gwz_latex_setup` 的报告修复，不能把skill加载成功说成环境齐全。

随包有22,583个可按ASCII来源编号输入的字形、真实OTF、目录和许可。不要让用户自己找另一个仓库，也不要把全部字库塞进上下文。

## 已有字：从项目到PDF

1. `gwz_latex_prepare({"project_dir":"outputs/论文排印","title":"研究札记"})`，返回实际 `tex_file`。
2. `gwz_latex_lookup({"query":"s030-067"})`，取得精确命令 `\ebag{s030-067}`。支持GlyphWiki名、来源编号和已知部件查询；查询不是字义识别。
3. 用DSH文件工具编辑 `main.tex`，正文与 `\ebag{编号}` 混排。
4. 调用 `gwz_latex_compile({"tex_file":"实际main.tex路径"})`，才会生成PDF。若已有论文，不覆盖原稿，确认宏包与字库目录存在后编译指定文件。

```tex
\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage{openglyph}
\OpenGlyphLoad{ebag}
\begin{document}
讨论这个形体\ebag{s030-067}，以及另一个字\ebag{s131-009}。
脚注里也能排\footnote{同一字形：\ebag{s030-067}。}。
\end{document}
```

`openglyph.sty`、`ebag/catalog.tex`、`ebag/OpenGlyphEbag.otf` 必须保留在一起。Tectonic/XeLaTeX支持Unicode字体；pdfLaTeX不支持。不需要shell-escape。

## 新字：优先用实际编号部件

先通过图像模板检索/inspect取得真实底字、部件和原图证据。也可离线 `gwz_latex_lookup` → `gwz_latex_inspect`；看过实际编号部件再编辑，不能从ID猜图形。

离线构字需要Python、Node、fonttools、skia-pathops。缺依赖时 `gwz_latex_setup({"install_dependencies":true})` 仅在工作文件夹创建独立环境，不修改全局Python，不装系统TeX引擎，不发付费模型请求。

将高层JSON放在论文目录的 `newforms.json`。下面仅演示已确认底字中的操作形式，实际目标字仍须看图核对：

```json
{
  "schema":"openglyph.project.v1",
  "namespace":"my",
  "glyphs":[
    {"id":"n1","base":"ebag:s030-067","edits":[
      {"op":"insert","parent":"root","id":"extra_dot","glyph":"primitive:dot","box":[77,129,119,167]}
    ]}
  ]
}
```

调用 `gwz_latex_build(project_file=实际JSON文件, output_dir=论文目录/myglyphs)`。它生成OTF、catalog、分配表、版本固定的高层程序和来源；修订时传旧 `allocation_file` 保持原地址。输出目录必须是新目录，不覆盖旧字库。

导言区添加 `\OpenGlyphLoad{myglyphs}`，正文写 `\gwglyph{my:n1}`；可以与 `\ebag{s030-067}` 和普通汉字穿插，之后再次调用compile。路径相对于实际main.tex所在目录，不是插件安装目录。

## 使用远端生成的字体

远端 `gwz_glyph_compose` 也能按program/proposal/glyph/ids/structure生成字体。用 `gwz_deliver` 取得真正的 `OpenGlyph-LaTeX排印包.zip` 后，在新建项目时传给prepare的 `font_bundle`；它会加载 generated 目录，并返回确切别名，不要自行猜 `og...:g1`。

模板JSON方案和IDS方案并行保留。前者能表达按编号修改、模块与饰笔；后者仍可用于明确的高层组字结构。正常LaTeX编译只消费已经生成的OTF和catalog，不会每次调用造字或云端模型。

## 修复与验收

- unknown glyph：先查实际编号，确认目录已加载，不要换成相近常用字。
- missing font/catalog：保持sty、catalog与OTF相对位置；不要只复制tex文件。
- missing character/字体不含码位：核对最终字体和映射版本，不能靠填PUA数字蒙混过去。
- 编译器不在PATH：使用setup返回的缺项，配置其绝对路径。
- 宿主文件沙箱拒绝：停下并报告授权缺口，不改用无沙箱执行绕过。
- 编译失败：保留完整日志，修复相关文件；不拿上次PDF当成新结果，不反复重跑同样错误。

PDF成功、字体嵌入、字形保真、学术释读分别报告。编译器和PDF检查器能检查前两项；后两项须对原图/实际字体比较并由人核定。所有输出仍可标为候选稿，不得伪造人工验收。
