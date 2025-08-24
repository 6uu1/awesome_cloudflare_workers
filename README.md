# Awesome Cloudflare Workers

一个精选的 Cloudflare Workers 脚本集合，旨在利用 Cloudflare 的全球边缘网络实现各种实用功能。所有脚本都可以轻松部署在 Cloudflare Pages 的免费套餐上。

## 目录

- [Awesome Cloudflare Workers](#awesome-cloudflare-workers)
  - [目录](#目录)
  - [包含的 Workers](#包含的-workers)
    - [1. 文件下载代理 (worker-dl)](#1-文件下载代理-worker-dl)
    - [2. 反向代理 (worker-reverse-proxy)](#2-反向代理-worker-reverse-proxy)
    - [3. VLESS + NAT64 代理 (worker-vless-nat64)](#3-vless--nat64-代理-worker-vless-nat64)
    - [4. VLESS + SOCKS5 over WebSocket 代理 (worker-vless-with-socks5-over-websocket)](#4-vless--socks5-over-websocket-代理-worker-vless-with-socks5-over-websocket)
  - [通用部署步骤](#通用部署步骤)

## 包含的 Workers

### 1. 文件下载代理 (worker-dl)

一个简单的代理脚本，用于通过您的 `pages.dev` 域名下载任何公共文件。

**使用方法**

通过构造以下格式的 URL 来使用此代理：

```
https://<你的-pages-dev-域名>/url/<要下载文件的完整URL>
```

**示例**：
要下载 `https://example.com/file.zip`，您需要访问：
`https://your-project.pages.dev/url/https://example.com/file.zip`

**配置**

此脚本无需任何配置。

### 2. 反向代理 (worker-reverse-proxy)

将所有访问您 `pages.dev` 域名的流量转发到您指定的目标主机。非常适合用于隐藏源站 IP 或利用 Cloudflare 的网络。

**⚠️ 重要：需要配置**

在使用前，您 **必须** 修改 [`worker-reverse-proxy.js`](c:/Users/Yulin/Documents/GitHub/awesome_cloudflare_workers/worker-reverse-proxy.js:4) 文件：

将第 4 行的 `target_host.com` 替换为您想要代理的目标域名。

```javascript
// worker-reverse-proxy.js
export default {
    async fetch(request) {
      let url=new URL(request.url);
      url.hostname='target_host.com'; // <-- 在这里修改为你的目标域名
      let new_request=new Request(url, request);
      return fetch(new_request);
    }
};
```

### 3. VLESS + NAT64 代理 (worker-vless-nat64)

一个功能强大的 VLESS 代理服务器，集成了智能 NAT64 故障回退机制。当直连目标网站失败时，它会自动通过公共 NAT64 服务生成一个动态的 IPv6 代理地址进行重试，有效解决 Cloudflare 生态内的网络限制问题。

**核心特性**

- **高效 VLESS 代理**：基于 Cloudflare 全球网络。
- **智能 NAT64 回退**：直连失败时自动切换，无需手动配置备用 IP。
- **零配置代理IP**：无需寻找和维护静态的 `PROXYIP`。

**详细用法和配置**

有关如何生成 UUID、参数定制和客户端配置的完整指南，请务必阅读：
➡️ **[worker-vless-nat64 使用指南](./worker-vless-nat64-usage.md)**

### 4. VLESS + SOCKS5 over WebSocket 代理 (worker-vless-with-socks5-over-websocket)

一个增强版的 Cloudflare Worker VLESS 代理脚本，核心功能是将传统的 SOCKS5 代理替换为 SOCKS5 over WebSocket，使代理服务器可以部署在 PaaS 平台上。

**核心特性**

- **SOCKS5 over WebSocket**：将 SOCKS5 协议封装在 WebSocket 中，解决 PaaS 平台不支持原生 SOCKS5 流量的问题
- **智能回退机制**：首先尝试直接连接目标服务器，直连失败时通过 SOCKS5 over WebSocket 代理进行中转
- **两种实现方案**：提供极简版本（25行代码）和完整版本（120行代码），满足不同需求

**配置要求**

在使用前，您 **必须** 配置 SOCKS5 over WebSocket 代理地址：

```javascript
// SOCKS5 over WebSocket address
// Format: user:pass@host:port or host:port
// Will connect via wss:// (secure WebSocket) to the host:port
let socks5Address = 'name:pass@example.com:443';
```

**详细用法和配置**

有关部署步骤、配置说明和技术实现的完整指南，请务必阅读：
➡️ **[worker-vless-with-socks5-over-websocket 使用指南](./worker-vless-with-socks5-over-websocket.md)**

## 通用部署步骤

所有脚本均可通过以下步骤部署到 Cloudflare Pages:

1.  **准备脚本**：根据您的需求，选择一个 `.js` 文件并完成必要的配置（如修改 `target_host.com`）。
2.  **重命名文件**：将您选择的 `.js` 文件重命名为 `_worker.js`。
3.  **部署到 Pages**：
    1.  登录到 Cloudflare 控制台，进入 **Workers & Pages**。
    2.  点击 **Create application** > **Pages** > **Upload assets**。
    3.  为您的项目命名。
    4.  将 `_worker.js` 文件拖拽到上传区域。
    5.  点击 **Deploy site**。

部署完成后，您就可以通过 Cloudflare 提供的 `*.pages.dev` 域名使用该 Worker 了。
