# 结构造字：调用与修改边界

所有 asset_id、glyph_ref、node、proposal_id 都应来自本次真实工具输出；下文程序中的 ebag 底字是可用示例，不是目标字的通用答案。

1. 对已经定位的单字图调用 gwz_glyph_template_search，取得候选的 program。
2. 原样把一个候选 program 交给 gwz_glyph_template_inspect，附 hint_asset_id 比较原图，先查看 root，再展开实际存在的 node。
3. 确定缺失或错位的部件后改 program.edits。坐标属于模板 0–200 空间，不是 PDF 像素坐标。别把两种坐标混用。
4. 若选择诊断建议，使用它返回的 proposal_id 与同一张 hint_asset_id；不可跨原图复制 proposal。
5. 调用 compose 后观察实际预览，再使用最终字体做 verify。差异可能来自选错字、少部件、比例/位置、源扫描或字体风格，不能一律当作 Unicode 问题。

按编号调整部件的 JSON 形式如下。只有前一次 inspect 确认存在这些 node、且确实符合原图时才可使用：

```json
{
  "schema": "guwenzi.template-program.v1",
  "base": "ebag:s030-067",
  "edits": [{"op": "move", "node": "r4/r0", "delta": [0, -6]}]
}
```

`move` 是移动已有部件，不会把错误部件变成正确的部件。`insert` 可插入查到的部件/模块；`drop` 删除实际记录；不要靠重复插入或多笔涂黑掩盖结构不符。想增加一笔时也要查看实际部件或允许的 primitive，不能凭空造 semantic stroke ID。

旧 IDS 路线仍保留：查询/确认部件后可传 `ids` 或 `structure`，服务端负责结构编译与 KAGE。它适合清楚的组合关系，但不能表达所有原型字和非线性饰笔。表达不了就保留原图、记录结构差异，使用可编辑模板或请求人工核定，不输出似是而非的通用汉字。
