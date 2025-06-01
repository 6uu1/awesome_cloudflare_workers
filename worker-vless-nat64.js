import { connect } from 'cloudflare:sockets';

// WebSocket 状态常量
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;

// DNS 缓存（简单实现，避免频繁解析）
const dnsCache = new Map();

export default {
  async fetch(request, env, ctx) {
    try {
      const userID = env.UUID || '';
      if (!userID) {
        throw new Error('未配置 UUID');
      }

      const upgradeHeader = request.headers.get('Upgrade');
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return handleHttpRequest(request, userID);
      }

      return await handleVLESSWebSocket(request, userID);
    } catch (err) {
      console.error('请求处理错误:', err);
      return new Response(`错误: ${err.message}`, { status: 500 });
    }
  },
};

// 处理 HTTP 请求
function handleHttpRequest(request, userID) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/') {
    return new Response('VLESS Proxy Server', { status: 200 });
  }

  if (path === `/${userID}`) {
    const host = request.headers.get('Host');
    const vlessConfig = `vless://${userID}@${host}:443?encryption=none&security=tls&sni=${host}&type=ws&host=${host}&path=/#${host}`;
    return new Response(vlessConfig, {
      status: 200,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    });
  }

  return new Response('Not Found', { status: 404 });
}

// 处理 VLESS WebSocket 连接
async function handleVLESSWebSocket(request, userID) {
  const wsPair = new WebSocketPair();
  const [clientWS, serverWS] = Object.values(wsPair);
  serverWS.accept();

  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || '';
  const wsReadable = createWebSocketReadableStream(serverWS, earlyDataHeader);
  let remoteSocket = null;
  let udpStreamWrite = null;
  let isDns = false;

  wsReadable.pipeTo(new WritableStream({
    async write(chunk) {
      if (isDns && udpStreamWrite) {
        return udpStreamWrite(chunk);
      }

      if (remoteSocket) {
        const writer = remoteSocket.writable.getWriter();
        await writer.write(chunk);
        writer.releaseLock();
        return;
      }

      const result = parseVLESSHeader(chunk, userID);
      if (result.hasError) {
        throw new Error(result.message);
      }

      const vlessRespHeader = new Uint8Array([result.vlessVersion[0], 0]);
      const rawClientData = chunk.slice(result.rawDataIndex);

      if (result.isUDP) {
        if (result.portRemote === 53) {
          isDns = true;
          const { write } = await handleUDPOutBound(serverWS, vlessRespHeader);
          udpStreamWrite = write;
          udpStreamWrite(rawClientData);
          return;
        }
        throw new Error('UDP 代理仅支持 DNS (端口 53)');
      }

      // 优先尝试直接连接
      try {
        remoteSocket = await connectDirectly(result.addressRemote, result.portRemote, rawClientData);
        pipeRemoteToWebSocket(remoteSocket, serverWS, vlessRespHeader);
      } catch (err) {
        console.error('直接连接失败:', err);
        // 直接连接失败，尝试使用 NAT64 IPv6
        try {
          const nat64IPv6 = await getNAT64IPv6(result.addressRemote);
          remoteSocket = await connectDirectly(nat64IPv6, result.portRemote, rawClientData);
          pipeRemoteToWebSocket(remoteSocket, serverWS, vlessRespHeader);
        } catch (natErr) {
          console.error('NAT64 连接失败:', natErr);
          throw new Error('无法连接到目标地址');
        }
      }
    },
    close() {
      closeSocket(remoteSocket);
    },
    abort(err) {
      console.error('WebSocket 流异常:', err);
      closeSocket(remoteSocket);
      serverWS.close(1011, '内部错误');
    },
  })).catch(err => {
    console.error('WebSocket 处理错误:', err);
    serverWS.close(1011, `处理失败: ${err.message}`);
  });

  return new Response(null, {
    status: 101,
    webSocket: clientWS,
  });
}

// 创建 WebSocket 可读流
function createWebSocketReadableStream(ws, earlyDataHeader) {
  return new ReadableStream({
    start(controller) {
      ws.addEventListener('message', event => controller.enqueue(event.data));
      ws.addEventListener('close', () => controller.close());
      ws.addEventListener('error', err => controller.error(err));

      if (earlyDataHeader) {
        try {
          const decoded = atob(earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/'));
          const data = Uint8Array.from(decoded, c => c.charCodeAt(0));
          controller.enqueue(data.buffer);
        } catch (e) {
          console.warn('早期数据解析失败:', e);
        }
      }
    },
  });
}

// 解析 VLESS 协议头
function parseVLESSHeader(buffer, userID) {
  if (buffer.byteLength < 24) {
    return { hasError: true, message: '无效的头部长度' };
  }

  const view = new DataView(buffer);
  const version = new Uint8Array(buffer.slice(0, 1));
  const uuid = formatUUID(new Uint8Array(buffer.slice(1, 17)));
  if (uuid !== userID) {
    return { hasError: true, message: '无效的用户 UUID' };
  }

  const optionsLength = view.getUint8(17);
  const command = view.getUint8(18 + optionsLength);
  let isUDP = false;

  if (command === 1) {
    // TCP
  } else if (command === 2) {
    isUDP = true;
  } else {
    return { hasError: true, message: '不支持的命令，仅支持 TCP(01) 和 UDP(02)' };
  }

  let offset = 19 + optionsLength;
  const port = view.getUint16(offset);
  offset += 2;

  const addressType = view.getUint8(offset++);
  let address = '';

  switch (addressType) {
    case 1: // IPv4
      address = Array.from(new Uint8Array(buffer.slice(offset, offset + 4))).join('.');
      offset += 4;
      break;
    case 2: // 域名
      const domainLength = view.getUint8(offset++);
      address = new TextDecoder().decode(buffer.slice(offset, offset + domainLength));
      offset += domainLength;
      break;
    case 3: // IPv6
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(view.getUint16(offset).toString(16).padStart(4, '0'));
        offset += 2;
      }
      address = ipv6.join(':').replace(/(^|:)0+(\w)/g, '$1$2');
      break;
    default:
      return { hasError: true, message: '不支持的地址类型' };
  }

  return {
    hasError: false,
    addressRemote: address,
    portRemote: port,
    rawDataIndex: offset,
    vlessVersion: version,
    isUDP,
  };
}

// 直接连接目标地址
async function connectDirectly(address, port, rawClientData) {
  const tcpSocket = await connect({
    hostname: address,
    port: port,
  });
  const writer = tcpSocket.writable.getWriter();
  await writer.write(rawClientData);
  writer.releaseLock();
  return tcpSocket;
}

// 获取 NAT64 IPv6 地址
async function getNAT64IPv6(address) {
  const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  if (ipv4Regex.test(address)) {
    return convertToNAT64IPv6(address);
  } else if (!address.includes(':')) { // 域名
    const ipv4 = await resolveDomainToIPv4(address);
    return convertToNAT64IPv6(ipv4);
  } else {
    throw new Error('不支持的地址类型');
  }
}

// 将 IPv4 转换为 NAT64 IPv6
function convertToNAT64IPv6(ipv4Address) {
  const parts = ipv4Address.split('.');
  if (parts.length !== 4 || parts.some(p => parseInt(p) > 255 || parseInt(p) < 0)) {
    throw new Error('无效的 IPv4 地址');
  }
  const hex = parts.map(p => parseInt(p).toString(16).padStart(2, '0'));
  return `2001:67c:2960:6464::${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
}

// 域名解析为 IPv4
async function resolveDomainToIPv4(domain) {
  if (dnsCache.has(domain)) {
    return dnsCache.get(domain);
  }
  const dnsQuery = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=A`, {
    headers: { 'Accept': 'application/dns-json' },
  });
  const dnsResult = await dnsQuery.json();
  if (dnsResult.Answer && dnsResult.Answer.length > 0) {
    const aRecord = dnsResult.Answer.find(record => record.type === 1);
    if (aRecord) {
      const ipv4Address = aRecord.data;
      dnsCache.set(domain, ipv4Address);
      return ipv4Address;
    }
  }
  throw new Error(`无法解析域名 ${domain} 的 IPv4 地址`);
}

// 数据转发
function pipeRemoteToWebSocket(remoteSocket, ws, vlessHeader) {
  let headerSent = false;

  remoteSocket.readable.pipeTo(new WritableStream({
    write(chunk) {
      if (ws.readyState === WS_READY_STATE_OPEN) {
        if (!headerSent) {
          const combined = new Uint8Array(vlessHeader.byteLength + chunk.byteLength);
          combined.set(new Uint8Array(vlessHeader), 0);
          combined.set(new Uint8Array(chunk), vlessHeader.byteLength);
          ws.send(combined.buffer);
          headerSent = true;
        } else {
          ws.send(chunk);
        }
      }
    },
    close() {
      if (ws.readyState === WS_READY_STATE_OPEN) {
        ws.close(1000, '正常关闭');
      }
    },
    abort(err) {
      console.error('数据转发异常:', err);
      closeSocket(remoteSocket);
      ws.close(1011, '数据传输错误');
    },
  })).catch(err => {
    console.error('数据转发错误:', err);
    closeSocket(remoteSocket);
    ws.close(1011, '转发失败');
  });
}

// 关闭套接字
function closeSocket(socket) {
  if (socket) {
    try {
      socket.close();
    } catch (e) {
      console.warn('关闭套接字失败:', e);
    }
  }
}

// 格式化 UUID
function formatUUID(bytes) {
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 处理 UDP DNS 请求
async function handleUDPOutBound(webSocket, vlessResponseHeader) {
  let isVlessHeaderSent = false;
  const transformStream = new TransformStream({
    transform(chunk, controller) {
      for (let index = 0; index < chunk.byteLength;) {
        const lengthBuffer = chunk.slice(index, index + 2);
        const udpPacketLength = new DataView(lengthBuffer).getUint16(0);
        const udpData = new Uint8Array(chunk.slice(index + 2, index + 2 + udpPacketLength));
        index += 2 + udpPacketLength;
        controller.enqueue(udpData);
      }
    },
  });

  transformStream.readable.pipeTo(new WritableStream({
    async write(chunk) {
      const resp = await fetch('https://1.1.1.1/dns-query', {
        method: 'POST',
        headers: { 'content-type': 'application/dns-message' },
        body: chunk,
      });
      const dnsQueryResult = await resp.arrayBuffer();
      const udpSize = dnsQueryResult.byteLength;
      const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff]);

      if (webSocket.readyState === WS_READY_STATE_OPEN) {
        console.log(`DNS 查询成功，消息长度: ${udpSize}`);
        const data = isVlessHeaderSent
          ? await new Blob([udpSizeBuffer, dnsQueryResult]).arrayBuffer()
          : await new Blob([vlessResponseHeader, udpSizeBuffer, dnsQueryResult]).arrayBuffer();
        webSocket.send(data);
        isVlessHeaderSent = true;
      }
    },
    abort(err) {
      console.error('DNS UDP 处理异常:', err);
    },
  })).catch(err => {
    console.error('DNS UDP 处理错误:', err);
  });

  const writer = transformStream.writable.getWriter();
  return { write: chunk => writer.write(chunk) };
}
