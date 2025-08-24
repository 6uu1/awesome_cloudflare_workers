# VLESS Proxy with SOCKS5 over WebSocket

这是一个增强版的 Cloudflare Worker VLESS 代理脚本，**核心功能是将传统的 SOCKS5 代理替换为 SOCKS5 over WebSocket**，使代理服务器可以部署在 PaaS 平台上。

## 核心改进：从 SOCKS5 到 SOCKS5 over WebSocket

### 问题背景
原版脚本使用传统的 SOCKS5 代理：
- 使用 TCP 直连到 SOCKS5 服务器
- 大多数 PaaS 平台不支持原生 SOCKS5 流量
- 防火墙容易识别和阻断 SOCKS5 协议

### 解决方案
将 SOCKS5 协议封装在 WebSocket 中：
- 使用 WebSocket 连接到代理服务器
- PaaS 平台原生支持 WebSocket (HTTP/HTTPS 流量)
- 防火墙难以识别封装后的 SOCKS5 流量

### 技术原理
```
客户端 → Cloudflare Worker → SOCKS5 over WebSocket → 目标服务器
         ↑                    ↑
    VLESS over WS        SOCKS5 over WS
```

1. **直连尝试**：首先尝试直接连接目标服务器
2. **WebSocket 代理中转**：直连失败时，通过 SOCKS5 over WebSocket 代理进行中转
3. **协议封装**：将 SOCKS5 协议数据完整封装在 WebSocket 消息中传输

## 实现方案对比

我们提供了两种实现方案，满足不同需求：

### 方案一：极简版本（推荐用于最小修改）

**修改量**：仅 25 行代码
**优点**：最小侵入性，易于理解和维护
**适用**：快速部署、学习理解、代码审查

#### 核心修改代码
```javascript
// 原来的 TCP 连接方式
const socket = connect({ hostname, port });

// 改为 WebSocket 连接方式
const ws = new WebSocket(`wss://${hostname}:${port}/ws`);
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
});

// 创建兼容的 socket 对象
const socket = {
    readable: new ReadableStream({
        start(controller) {
            ws.addEventListener('message', (event) => {
                controller.enqueue(new Uint8Array(event.data));
            });
            ws.addEventListener('close', () => controller.close());
        }
    }),
    writable: new WritableStream({
        write(chunk) { ws.send(chunk); }
    }),
    closed: new Promise(resolve => ws.addEventListener('close', resolve))
};
```

### 方案二：完整版本（推荐用于生产环境）

**修改量**：约 120 行代码
**优点**：功能完整，调试友好，错误处理完善
**适用**：生产环境、需要详细日志、复杂网络环境

#### 核心组件
1. **WebSocket 适配器**：完整的 WebSocket 到 Socket 转换器
2. **错误处理**：详细的连接状态监控和错误日志
3. **数据类型处理**：支持多种 WebSocket 数据格式
4. **超时保护**：10秒连接超时机制

## 配置说明

### 基本配置

```javascript
// 用户 UUID（必须修改）
let userID = 'your-uuid-here';

// SOCKS5 over WebSocket 代理地址
let socks5Address = 'username:password@your-proxy-server.com:443';

// 备用直连 IP（可选）
let proxyIP = '';
```

### SOCKS5 地址格式

支持以下格式：
- `username:password@hostname:port` - 带认证的代理
- `hostname:port` - 无认证的代理

示例：
```javascript
let socks5Address = 'user:pass@proxy.example.com:443';
```

### 关键技术细节

#### WebSocket 路径
- **正确路径**：`/ws` (gost 默认路径)
- **错误路径**：`/` (会导致 HTTP 404 错误)

#### 认证机制
SOCKS5 用户名/密码认证完全有效：
```javascript
// 自动解析认证信息
const { username, password, hostname, port } = parsedSocks5Address;

// 发送认证请求
const authRequest = new Uint8Array([
    1,
    username.length,
    ...encoder.encode(username),
    password.length,
    ...encoder.encode(password)
]);
```

## 部署步骤

### 1. 准备 SOCKS5 over WebSocket 服务器

使用 [gost](https://github.com/go-gost/gost) 在 PaaS 平台部署：

```bash
# 启动 SOCKS5 over WebSocket 服务器
gost -L socks5+ws://:8080

# 带认证的版本
gost -L socks5+ws://user:pass@:8080
```

**重要**：gost 默认 WebSocket 路径是 `/ws`，不是根路径 `/`

### 2. 应用代码修改

#### 选择极简版本（推荐）
```bash
# 应用极简补丁
patch worker-with-socks5-experimental.js < socks5-over-websocket.min.patch
```

#### 选择完整版本
```bash
# 应用完整补丁
patch worker-with-socks5-experimental.js < socks5-over-websocket.patch
```

#### 手动修改（极简版本）
只需要修改 `socks5Connect` 函数中的连接建立部分：

```javascript
// 找到这行代码：
const socket = connect({ hostname, port });

// 替换为：
const ws = new WebSocket(`wss://${hostname}:${port}/ws`);
await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
});

const socket = {
    readable: new ReadableStream({
        start(controller) {
            ws.addEventListener('message', (event) => {
                controller.enqueue(new Uint8Array(event.data));
            });
            ws.addEventListener('close', () => controller.close());
        }
    }),
    writable: new WritableStream({ write(chunk) { ws.send(chunk); } }),
    closed: new Promise(resolve => ws.addEventListener('close', resolve))
};
```

### 3. 配置 Cloudflare Worker

1. 修改 `userID` 为您的 UUID
2. 设置 `socks5Address` 为您的代理服务器地址
3. 部署到 Cloudflare Workers

### 4. 客户端配置

使用支持 VLESS over WebSocket 的客户端连接：

```
协议: VLESS
地址: your-worker.workers.dev
端口: 443
UUID: your-uuid-here
传输: WebSocket
路径: /your-uuid-here
TLS: 开启
```

## 技术实现原理

### 核心挑战：Cloudflare Workers WebSocket 限制

#### 问题分析
1. **Fetch API 限制**：`fetch()` 不支持 `wss://` URL
   ```javascript
   // ❌ 这会失败
   fetch('wss://server.com', { headers: { Upgrade: 'websocket' } })
   ```

2. **WebSocket 方向性**：
   - `fetch()` + `WebSocketPair` 用于**接收**客户端连接
   - `new WebSocket()` 用于**发起**到外部服务器的连接

#### 解决方案
```javascript
// ✅ 正确的方式
const ws = new WebSocket('wss://server.com/ws');
```

### 关键技术点

#### 1. WebSocket 路径发现
通过研究 [gost 官方文档](https://gost.run/en/tutorials/protocols/ws/)，发现：
- **默认路径**：`/ws`（不是根路径 `/`）
- **路径匹配**：客户端和服务器路径必须完全一致

#### 2. Socket 接口兼容性
原代码期望 `connect()` 返回具有以下接口的对象：
```javascript
{
    readable: ReadableStream,
    writable: WritableStream,
    closed: Promise
}
```

我们的 WebSocket 适配器必须提供相同的接口。

#### 3. 数据格式处理
WebSocket 可能接收不同格式的数据：
```javascript
// 处理多种数据类型
if (event.data instanceof ArrayBuffer) {
    data = new Uint8Array(event.data);
} else if (event.data instanceof Uint8Array) {
    data = event.data;
} else if (typeof event.data === 'string') {
    data = new TextEncoder().encode(event.data);
}
```

### 实现方案对比

| 特性 | 极简版本 | 完整版本 |
|------|----------|----------|
| **修改量** | 25行 | 120行 |
| **新增函数** | 0个 | 1个 |
| **错误处理** | 基础 | 详细 |
| **调试能力** | 弱 | 强 |
| **维护复杂度** | 低 | 中等 |
| **生产就绪** | 基础 | 完整 |

### SOCKS5 协议完整性

两个版本都完整保留了 SOCKS5 协议实现：
- ✅ 握手协商（支持无认证和用户名/密码认证）
- ✅ 用户名/密码认证（RFC 1929）
- ✅ 连接请求（支持 IPv4/IPv6/域名）
- ✅ 数据中转（完整的双向数据流）


## 应用修改

### 极简版本（推荐）
```bash
patch worker-with-socks5-experimental.js < minimal-websocket.patch
```

### 完整版本
```bash
patch worker-with-socks5-experimental.js < socks5-over-websocket.patch
```

## 故障排除

### 常见错误和解决方案

#### 1. Fetch API 错误
```
错误：Fetch API cannot load: wss://...
原因：使用了 fetch() 连接 WebSocket
解决：改用 new WebSocket() 构造函数
```

#### 2. HTTP 404 错误
```
错误：expected server to reply with HTTP status code 101, but received 404
原因：WebSocket 路径错误（使用了 "/" 而不是 "/ws"）
解决：确保使用正确的路径 "/ws"
```

#### 3. 连接超时
```
错误：WebSocket connection timeout
原因：代理服务器未运行或网络问题
解决：检查 gost 服务器状态和网络连接
```

#### 4. 认证失败
```
错误：fail to auth socks server
原因：用户名或密码错误
解决：验证 socks5Address 中的认证信息
```