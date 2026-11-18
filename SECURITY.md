# Security Policy

## Supported versions

当前维护 `2.x` 版本。安全修复优先进入最新 release。

## 报告安全问题

请使用 GitHub 的 **Security → Report a vulnerability**（GitHub Security Advisories）私下报告，不要先开公开 Issue。

报告中请包含：

- 受影响版本；
- 复现步骤或最小 PoC；
- 影响范围（读取文件、执行命令、泄露数据、绕过审批等）；
- 建议修复方式（如有）。

## 安全边界

- 插件只在用户工作区和 DSH profile 允许的范围内读写文件。
- `gongwen_browser` 和微信公众号读取会请求 DSH 审批；拒绝后不会启动 Chrome。
- 微信公众号只有白名单账号可作为官方材料；`wechatAccounts` 是用户显式扩展，不是自动信任。
- 事实核查只采信政府机关官网及人民网、共产党员网、新华社等官方来源的正文；搜索摘要不作为证据。
- 插件不内置 API Key，不主动上传公文；如果使用云模型或云检索，数据会按 DSH 配置发送到对应服务商。
- 自动校正只处理有官方原句、可精确替换的日期和文件号；政治性提法不会自动改写。

## 不要提交

- 真实公文、个人信息、内网地址、密钥、token；
- `.gongwen-writer/`、浏览器 profile、生成的 `.docx`；
- 含敏感内容的 Issue 日志。

## 依赖

运行时依赖 DSH 自带 Node 和 Python 环境；Word 渲染依赖 `python-docx`。请定期更新 DSH 和 Python 依赖，并审查新增依赖。
