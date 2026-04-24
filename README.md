# TypeScript SDK for ATH 可信协议

[English](README.en.md)

> 🔌 让你的TypeScript/JavaScript项目5分钟接入ATH可信生态

## 🎯 项目简介

这是ATH可信代理握手协议的官方TypeScript开发工具包，专门为前端和Node.js开发者设计，让你不需要了解复杂的协议细节，只用几行代码就能让你的项目拥有可信交互能力。

## ✨ 核心特性

- ✅ 同时支持网关模式和原生模式两种部署方式
- ✅ 完整的TypeScript类型定义，开发体验一流
- ✅ 内置ES256 JWT签名，支持`jti`防重放保护
- ✅ 自动PKCE (RFC 7636) + 状态参数CSRF防护
- ✅ 三重作用域交叉校验：`有效 = 代理批准 ∩ 用户授权 ∩ 请求范围`
- ✅ 兼容Node.js 18+版本

## 📦 安装方式

### npm安装
```bash
npm install @ath-protocol/client @ath-protocol/types
```

### yarn安装
```bash
yarn add @ath-protocol/client @ath-protocol/types
```

### pnpm安装
```bash
pnpm add @ath-protocol/client @ath-protocol/types
```

服务端开发还需要安装：
```bash
npm install @ath-protocol/server
```

## 🚀 快速上手（网关模式）

### 第一步：初始化客户端

```typescript
import { generateKeyPair } from 'jose';
import { ATHGatewayClient } from '@ath-protocol/client';

// 生成ES256密钥对用于代理身份认证
const { privateKey } = await generateKeyPair('ES256');

const client = new ATHGatewayClient({
  url: 'https://your-ath-gateway.com',   // 你的ATH网关地址
  agentId: 'https://your-agent.example.com/.well-known/agent.json', // 你的AI代理ID
  privateKey,                             // 你的AI代理私钥
  keyId: 'my-key-1',                     // 密钥标识
});
```

### 第二步：发现服务并注册代理

```typescript
// 发现网关支持的服务提供商
const discovery = await client.discover();
console.log('可用服务:', discovery.supported_providers.map(p => p.display_name));

// 注册代理并申请权限（Phase A：应用端授权）
const reg = await client.register({
  developer: { name: '示例公司', id: 'dev-123' },
  providers: [{ provider_id: 'github', scopes: ['repo', 'read:user'] }],
  purpose: '代码审查助手',
});
console.log('注册状态:', reg.agent_status);
console.log('批准的权限:', reg.approved_providers[0].approved_scopes);
```

### 第三步：用户授权并获取令牌

```typescript
// 发起用户授权流程（Phase B：用户端OAuth授权）
const auth = await client.authorize('github', ['repo']);
console.log('请引导用户访问:', auth.authorization_url);
// 用户在浏览器中完成OAuth授权...

// 用户授权完成后，用授权码换取ATH访问令牌
const token = await client.exchangeToken(code, auth.ath_session_id);
console.log('获得访问令牌:', token.access_token);
console.log('有效权限:', token.effective_scopes);
console.log('作用域交叉:', token.scope_intersection);
```

### 第四步：访问服务并撤销

```typescript
// 通过网关代理访问上游服务API
const user = await client.proxy('github', 'GET', '/user');
console.log('用户信息:', user);

// 使用完毕后撤销令牌
await client.revoke();
```

## 🔗 原生模式快速上手

```typescript
import { generateKeyPair } from 'jose';
import { ATHNativeClient } from '@ath-protocol/client';

const { privateKey } = await generateKeyPair('ES256');

const client = new ATHNativeClient({
  url: 'https://mail-service.example.com',
  agentId: 'https://your-agent.example.com/.well-known/agent.json',
  privateKey,
});

// 发现服务（获取 /.well-known/ath-app.json）
const disc = await client.discover();

// 注册 → 授权 → 换取令牌（流程同网关模式）
await client.register({
  developer: { name: '示例公司', id: 'dev-123' },
  providers: [{ provider_id: disc.app_id, scopes: ['mail:read'] }],
  purpose: '邮件阅读助手',
});
const auth = await client.authorize(disc.app_id, ['mail:read']);
// ... 用户授权 ...
const token = await client.exchangeToken(code, auth.ath_session_id);

// 直接调用服务API
const messages = await client.api('GET', '/v1/messages');
```

## 📚 包说明

| 包名 | 说明 | 适用场景 |
|------|------|----------|
| `@ath-protocol/client` | 核心客户端库（`ATHGatewayClient` + `ATHNativeClient`） | 大部分开发者使用这个就够了 |
| `@ath-protocol/types` | 类型定义 + Zod验证器（从协议Schema自动生成） | TypeScript项目需要 |
| `@ath-protocol/server` | 服务端工具库（Handler框架、注册表、令牌存储、代理） | 开发ATH网关或兼容服务时使用 |

## 🔒 协议v0.1安全特性

| 特性 | 说明 |
|------|------|
| JWT `jti` 防重放 | 每个认证JWT包含唯一`jti`，服务端可拒绝重放 |
| `state` 必填 | 授权请求必须包含CSPRNG生成的128位`state`参数 |
| 令牌交换需认证 | `exchangeToken`时需提供新的`agent_attestation` JWT |
| 撤销需密钥认证 | 代理撤销令牌时需提供`client_secret`（遵循RFC 7009） |
| 回调URI精确匹配 | `redirect_uris`使用精确匹配验证 |
| 作用域交叉 | `有效 = 代理批准 ∩ 用户授权 ∩ 请求范围` |

## 🎯 适用场景

- 🌐 浏览器端AI应用开发
- 🖥️ Node.js服务端集成
- 💻 跨平台Electron应用接入
- 📱 小程序/移动端H5开发
- 🔌 浏览器插件开发

## 🛠️ 开发指南

```bash
pnpm install          # 安装依赖
pnpm run generate     # 从协议Schema重新生成类型
pnpm run build        # 构建所有包
pnpm run test         # 运行服务端单元测试
pnpm run test:e2e     # 运行端到端集成测试
pnpm run test:all     # 运行所有测试
```

## 📖 文档资源

- [完整API文档](https://athprotocol.dev/docs/sdk/typescript)
- [示例项目](https://github.com/ath-protocol/typescript-sdk/tree/main/examples)
- [ATH协议规范](https://github.com/ath-protocol/agent-trust-handshake-protocol)
- [常见问题](https://athprotocol.dev/docs/faq)

## 🤝 与其他组件的关系

```
你的TypeScript项目 → 本SDK → ATH网关 → 后端服务
                          ↘ 原生模式直连 ↗
```

本SDK负责处理和ATH网关（或原生ATH服务）的注册、认证、授权、代理等所有复杂逻辑，你只需要关心业务代码即可。

## 📄 开源协议

本项目采用 **OpenATH License** 开源协议，具体条款请查看LICENSE文件。
