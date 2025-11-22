# The Delphi Engine v0

多智能体 + 黑板架构 Demo（网络编程预展示）。

## 快速开始

```bash
npm install
export OPENAI_API_KEY=...   # 或在上级目录 e.txt 中写入 API_KEY=xxx
# 方案 A：先开前端（不依赖 engine，可空白等待）
npm run ui        # 静态页 http://localhost:4173
# 方案 B：直接开 engine（带静态页）：
npm run engine    # http://localhost:3000
# 可先开 ui，再启动 engine，前端会自动连上 /events
# 注意：ui 运行在 4173 时，会跨域连接 http://localhost:3000 的 engine（已开启 CORS）
```

## 端点
- `POST /api/run`：触发一次事件→三 Agent 输出→黑板整合→追问→统一决策，事件通过 SSE 广播。
- `GET /events`：SSE 实时事件（news/opinions/global_view/follow_up/decision）。
- `GET /api/state`：当前内存状态快照。
- `GET /health`：健康检查。
- **A2A 兼容接口（简化实现，用于演示）**
  - `POST /v1/message:send`：遵循 A2A SendMessage，返回 Task（含 history/artifacts）。
  - `GET /v1/tasks`、`GET /v1/tasks/:id`：查询任务。
  - `GET /v1/agentCard`：返回 Blackboard 的 Agent Card。
  - `GET /v1/message:stream`：A2A 风格 streaming（重定向到 /events）。
  - A2A 消息类型：opinion_request/opinion_response、annotation_request、follow_up、task_status。

## 结构
- `src/server.js`：Express 服务 + Agent/黑板逻辑 + SSE。
- `public/index.html`：静态前端，实时展示状态、时间线、日志、标注。
- `src/agents.js`：LLM 驱动的 Agent（Long/Short/Macro）、标注、追问回复（A2A Message）。
- `src/llm.js` / `src/config.js`：OpenAI 客户端与 API Key 加载（环境变量优先，备用从 ../e.txt）。

## 说明
- 目前输入事件为内置示例，可在 `getCurrentNews()` 中接入真实 API。
- Follow-up 由黑板向短期 Agent 发起，短期 Agent 以 A2A 消息返回调整建议，体现在统一决策中。
- Agents 会对彼此观点做标注（annotation_request），前端在 Agent 卡片展示简要标签。
- 所有状态保存在内存，便于课堂 Demo；如需持久化可扩展数据库或消息队列。
- A2A 数据模型参考官方 proto，Task/Message/AgentCard 已提供最小可运行示例，可与外部 A2A 客户端对接演示。
