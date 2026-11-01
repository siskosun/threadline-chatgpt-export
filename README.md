# 研线 · ThreadLine Archive

纯浏览器扩展：将选定的 ChatGPT 对话和可取得的附件字节保存到本地，再将历史文件、短提示和选中的原始文件带到一个新的普通 ChatGPT 对话。

**当前版本：0.7.1 工程候选版。** 代码、测试和构建在 GitHub 云端进行；不要求用户运行 Python、Node、本地 HTTP 服务或常驻程序。开发构建工具不属于产品运行依赖。当前分支不是已发布的稳定版，不代表真实账号兼容性已验收。

实现分支：`threadline/archive-handoff-cloud`。评审入口：[PR #2](https://github.com/siskosun/threadline-chatgpt-export/pull/2)。`main` 仍是上游锁定快照，不要把 main 或旧版上游安装包当成本候选版。

## 使用流程

**保存对话。** 打开已有 ChatGPT 对话，点击扩展图标，在工作区选择源标签页并开始保存。只有这次明确选定的对话会被读取。可另行勾选“实时缓存本对话新生成文件”；关闭页面、停止缓存或浏览器/后台进程重启后，不会静默恢复抓取。

**本地档案。** IndexedDB 保存规范化的可见消息图、分支和真实文件 Blob。文件必须通过字节数和 SHA-256 校验后才标记已保存。下载失败、接口不可用、未知指针和损坏文件分别保留状态；不会创建空附件冒充成功。工作区可以导出 ZIP、恢复本扩展生成的 ZIP、下载原件，并对照官方导出 ZIP 中可识别的文件。

**接续到新对话。** 选择需要的原始文件，填写简短目标/进度，生成接续包。历史以编号 Markdown 附件承载，输入框只填短提示。新窗口先绑定到本次接续，再导航到 ChatGPT；文件注入只对空白的普通新聊天执行。扩展不会点击 Send。网页无法确认上传时，显示未知，用户从文件暂存区下载或尝试拖拽，人工上传。

## 安装候选包

在 [GitHub Actions](https://github.com/siskosun/threadline-chatgpt-export/actions) 中打开该分支**准确提交 SHA**的成功 `verify` 运行，下载 `threadline-candidate-<SHA>` artifact。解压外层 artifact，再解压其中 `threadline-edge-0.7.1-candidate.zip` 或 Chrome 对应包。包含 `manifest.json` 的目录就是加载目标。

建议使用独立 Edge 配置进行验收。在扩展管理页开启开发者模式，选择“加载解压缩的扩展”，指向上述目录。不要卸载现有研线或清除旧数据。安装包附 `BUILD_INFO.json`，可核对源提交；artifact 附 `SHA256SUMS`，可核对安装包字节。

候选包只由通过检查的云端流水线产生，不从用户电脑或临时原型目录复制。包内含 MIT 许可证和第三方通知。当前不提供已验收的 Firefox 包，也没有商店发布。

## 实现范围与保守行为

- 保留可访问 mapping 的分支结构，并检测断链、环、重复消息和未知内容结构。只保存可见内容；隐藏系统消息和内部推理正文不进入档案。
- 识别 `file-service://`、`sediment://`、文件 metadata 和 `sandbox:` 引用。非公开网页接口变化可能导致采集失败。
- 本地二进制以 Blob/分块持久化。Base64 只用于受限大小的扩展消息，不作为长期文件存储格式。
- 内容寻址文件可在多个档案间共享；删除一份本地档案会使其接续记录失效，但不会删除其他档案仍引用的文件，也不会删除 ChatGPT 源对话。
- ZIP/ZIP64 生成和恢复校验支持逐块处理。恢复器目前有明确的资源上限：最多 50,000 个条目、32 MiB 中央目录、4 GiB 声明解压总量；超出时拒绝而非截断。这不是已通过的大文件容量承诺。
- 附件批次大小可由用户配置。默认值 10 是保守的界面设置，不宣称它是 ChatGPT 固定上限。索引和历史文件也占用上传名额；只有首批尝试自动附加，剩余批次明确列出，须人工补充。
- 文件 chip 出现不等于上传成功，上传成功不等于模型已读取。当前只对明确的完成状态作确认，其他网页结构保留 `upload_unknown`。
- 官方 ZIP 对照目前支持嵌套 ZIP、准确文件 ID 和无歧义原文件名；未知映射格式报告未识别，不据此断言官方导出没有该文件。
- 缓存开启之前已失效且远端不可下载的文件无法凭空恢复。HTTP 403/404/422 只说明本次读取结果，不等同于永久删除。
- 当前工作区按标题搜索档案；不宣称跨会话语义搜索、自动研究总结或旧研线课题/证据库迁移已实现。

## 隐私与安全边界

产品无第三方云端数据服务。认证信息只在所选 ChatGPT 页面内存使用，不写入 IndexedDB、ZIP、日志或 GitHub。可选下载权限只覆盖已列明的 OpenAI 文件域名，不申请 `<all_urls>`。外部下载不携带 ChatGPT Cookie、Authorization 或 Referer，并拒绝重定向。非许可域名媒体不会自动下载。

不会自动发送消息、覆盖已有草稿、注入 Project/Temporary/旧对话，或删除源对话。新窗口/文档身份改变后不会自动重放接续。浏览器清理数据、磁盘故障或卸载扩展可能导致本地工作副本丢失；请另存 ZIP，不要把浏览器缓存当作永久备份。

## 验证方式

云端流水线执行：

```text
python build.py
node --test tests/*.test.mjs
xvfb-run -a python tests/browser_e2e.py
xvfb-run -a python tests/storage_edges.py
```

Node 回归覆盖 SHA-256、分支图、资产身份、ZIP/ZIP64、损坏拦截、权限和目标绑定。合成 Chromium MV3 测试加载实际扩展，验证采集、文件字节、IndexedDB、ZIP 往返、实时缓存、重启恢复、新窗口接续、既有草稿保护、上传未知和零自动发送。Linux 与 Windows 均进行构建和 Node 回归；完整浏览器合成链路目前在 Linux 执行。

这些测试**不是**真实 ChatGPT 登录验收。真实旧对话、当前站点 DOM/协议、当前账号限制、用户官方导出格式、模型读取效果、大文件压力和真人可用性仍需验收。不得只凭 CI 绿灯发布稳定版。验收步骤见 [docs/REAL_ACCOUNT_ACCEPTANCE.md](docs/REAL_ACCOUNT_ACCEPTANCE.md)。

## 开源来源与开发规则

上游 [thekester/chatgpt-export](https://github.com/thekester/chatgpt-export) 固定在 v0.6.59 / `13568bf75688de74a5af563b20d5ccd28f4ad532`（MIT）；保留其历史、许可和归档格式经验。新聊天文件注入交互参考 MoveChat v1.2.1；不采用其自动发送路径。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

旧研线 UX 的继承内容是低噪音蓝灰风格、清晰主操作、持续错误、窄宽屏适配及分开显示保存/下载/上传/发送状态，不是恢复旧产品的复杂信息架构。开发约束见 [AGENTS.md](AGENTS.md)。
