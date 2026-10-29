# 本地截图导单 Worker

该进程在档口 Mac 上运行，读取云数据库里的 `import_tasks`，调用本机 Ollama 视觉模型识别截图，再把合并后的结果写回任务。模型图片不会发给第三方付费模型。

默认模型：`minicpm-v4.5`。

## 准备

1. 确认 Ollama 已运行并已下载模型：`ollama list`。
2. 执行 `npm install`。
3. 复制 `.env.example` 为 `.env`。
4. 云开发环境和长期访问凭据需要单独配置。凭据具有持久访问权限，必须在用户确认后进行。

链接导单会调用本机 Chrome 渲染慧策公开分享页，再将页面截图交给 Ollama。默认 Chrome 路径适用于 macOS，如果安装位置不同，请在 `.env` 中设置 `CHROME_EXECUTABLE_PATH`。

## 运行

将 `.env` 中的变量安全加载进终端后：

```bash
npm start
```

仅处理一个任务可使用 `npm run once`。
