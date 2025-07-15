# worker-vless-nat64.js 使用指南

## 简介

这是一个部署在 Cloudflare Pages 上的 VLESS 代理服务器脚本，其核心特性是集成了**动态 NAT64 故障回退（Fallback）机制**。

当客户端通过此 Worker 访问目标网站时，它会首先尝试**直接连接**。如果直连成功，则正常转发数据。但如果直连后没有任何数据返回（通常发生在目标网站本身也由 Cloudflare 托管，导致 Worker 无法直接访问的情况下），脚本的 `retry` 机制会被触发。此时，它会自动利用公共 NAT64 服务，将原始的目标地址（无论是 IPv4 还是域名）**动态转换**为一个特殊的 IPv6 地址作为代理 IP，并用这个新地址发起重试。

这个过程是完全自动的，有效解决了 Cloudflare 生态内的网络限制问题，实现了零配置的备用IP方案。

## 核心特性

- **🚀 高效 VLESS 代理**：基于 Cloudflare 的全球边缘网络，提供低延迟的代理服务。
- **🧠 智能 NAT64 回退**：无需手动配置备用 IP，在直连失败时自动通过 NAT64 生成动态代理地址。
- **⚙️ 零配置代理IP**：您不再需要寻找和维护一个静态的 `PROXYIP` 环境变量。
- **🌍 免费部署**：可以完全部署在 Cloudflare Pages 的免费套餐上。
- **✏️ 参数可定制**：您可以轻松修改脚本中的 `userID` 和 `NAT64_PREFIX`，或则通过环境变量设置 `UUID` 和 `NAT64_PREFIX`。

## 生成方法

此脚本是通过对官方 `edgetunnel` 项目中的 `worker-vless.js` 文件应用一个补丁来生成的。

### 第一步：获取原始的 `worker-vless.js` 文件

打开您的终端（Linux, macOS, or Git Bash on Windows），使用 `curl` 或 `wget` 下载原始文件。

```bash
curl -O https://raw.githubusercontent.com/zizifn/edgetunnel/main/src/worker-vless.js
```

### 第二步：下载并应用`vless-nat64.patch`文件

下载本仓库的 `vless-nat64.patch` 并在终端中，使用 `patch` 命令来合并改动。

```bash
curl -O https://raw.githubusercontent.com/cylind/awesome_cloudflare_workers/main/vless-nat64.patch
patch worker-vless.js < vless-nat64.patch
```

命令成功执行后，你的 `worker-vless.js` 文件就已经包含了所有 NAT64 功能。你可以将其重命名为 `worker-vless-nat64.js` 以作区分。

## 使用方法

### 第一步：参数定制（可选）

打开打好补丁的 `worker-vless.js` 文件（或则直接使用本仓库已打好补丁的 `worker-vless-nat64.js`文件），你可以在文件顶部修改 `userID` 和 `NAT64_PREFIX`。

```javascript
// ...
// How to generate your own UUID:
// [Windows] Press "Win + R", input cmd and run:  Powershell -NoExit -Command "[guid]::NewGuid()"
let userID = 'd342d11e-d424-4583-b36e-524ab1f0afa4'; // <-- 修改为你自己的 UUID

let NAT64_PREFIX = '2602:fc59:b0:64::'; // <-- 公共NAT64前缀
// ...
```

### 第二步：重命名文件

为了能被 Cloudflare Pages 的 Functions 功能识别，你需要将这个 JS 文件重命名为 `_worker.js`。

```bash
mv worker-vless.js _worker.js
```

### 第三步：部署到 Cloudflare Pages

1.  登录到 Cloudflare 控制台。
2.  在左侧导航中，进入 **Workers & Pages**。
3.  点击 **Create application** -> **Pages** -> **Upload assets**。
4.  给你的项目起一个名字，例如 `my-vless-proxy`。
5.  将你本地的 `_worker.js` 文件**直接拖拽**到上传区域。
6.  点击 **Deploy site**。
7.  （可选）配置环境变量 `UUID` 和 `NAT64_PREFIX`，然后重试部署使环境变量生效。

部署完成后，Cloudflare 会提供给你一个 `*.pages.dev` 的域名。现在，你的 VLESS + NAT64 代理服务已经全球在线了！

### 第四步：配置客户端

你需要将其添加到支持 VLESS 协议的客户端软件中才能使用。

#### 方法一：手动配置 (以 clash-meta 为例)

你可以手动编辑你的客户端配置文件。以下是一个 `clash-meta` 的 YAML 配置示例：

```yaml
- type: vless
  name: vless-nat64 # 自定义节点名称
  server: my-vless-proxy.pages.dev # 替换为你的 Pages 域名
  port: 443
  uuid: d342d11e-d424-4583-b36e-524ab1f0afa4 # 替换为你在脚本中设置的 userID
  network: ws
  tls: true
  udp: true
  sni: my-vless-proxy.pages.dev # 替换为你的 Pages 域名
  client-fingerprint: chrome
  ws-opts:
    path: "/?ed=2048"
    headers:
      host: my-vless-proxy.pages.dev # 替换为你的 Pages 域名
```

**关键参数说明:**
*  `server`可以是Cloudflare Pages 域名，也可以是Cloudflare优先IP或域名。
*  `sni`, `headers.host`: 这两项都必须是你的 Cloudflare Pages 域名。
*   `uuid`: 必须与你在 `_worker.js` 文件中设置的 `userID` 或环境变量中设置的`UUID`完全一致。
*   `udp: true`: 开启此选项后，DNS 查询（端口53）将被代理。

#### 方法二：自动获取配置 (推荐)

脚本内置了配置生成功能，这是最简单快捷的方法。

直接在你的浏览器中访问 `https://<你的Pages域名>/<你的UUID>`，例如：
`https://my-vless-proxy.pages.dev/d342d11e-d424-4583-b36e-524ab1f0afa4`

页面会直接显示出已经为你生成好的、可供复制的 **v2ray 订阅链接**和 **clash-meta 配置片段**。直接复制并导入到你的客户端即可！