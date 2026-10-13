# src/vendor — 第三方库本地副本

构建产物默认引用 CDN 上的 `html2canvas@1.4.1` 用于 PNG 导出。
若需 **完全离线**（推荐，评审/用户网络环境不可控），把 `html2canvas.min.js`
放到本目录即可 —— `src/builder.js` 会自动检测并内联进产物，
未命中时才回退到 CDN。

```bash
# 示例（任意一种）
curl -L -o html2canvas.min.js https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js
```

- 文件：`html2canvas.min.js`（约 200 KB）
- 许可证：MIT
- 用途：仅用于「下载 PNG」；缺失时页面自动降级为「打印 / 另存为 PDF」，功能不中断

> 本目录不提交第三方库时，仓库依然可运行，属于可选优化项。
