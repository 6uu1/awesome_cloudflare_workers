/**
 * Cloudflare Pages Worker for WebSocket Proxy
 * 专为 Cloudflare Pages 部署优化的版本
 */

// 配置 - 请修改为您的实际域名
const TARGET_HOST = 'example.com';
const WS_PATH = '/ws-path';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // WebSocket 升级请求
    if (request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, url);
    }
    
    // 普通 HTTP 请求
    return handleHttpRequest(request, url);
  }
};

/**
 * 处理 WebSocket 连接
 */
async function handleWebSocket(request, url) {
  // 检查路径
  if (url.pathname !== WS_PATH) {
    return new Response('Not Found', { status: 404 });
  }
  
  // 验证 WebSocket 头
  const upgradeHeader = request.headers.get('Upgrade');
  const connectionHeader = request.headers.get('Connection');
  
  if (upgradeHeader !== 'websocket' || !connectionHeader?.toLowerCase().includes('upgrade')) {
    return new Response('Expected WebSocket', { status: 400 });
  }
  
  try {
    // 创建 WebSocket 对
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    
    // 接受服务器端连接
    server.accept();
    
    // 连接到目标服务器
    const targetUrl = `wss://${TARGET_HOST}${WS_PATH}`;
    const targetWs = new WebSocket(targetUrl);
    
    // 双向数据转发
    server.addEventListener('message', event => {
      if (targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(event.data);
      }
    });
    
    targetWs.addEventListener('message', event => {
      if (server.readyState === WebSocket.OPEN) {
        server.send(event.data);
      }
    });
    
    // 连接关闭处理
    server.addEventListener('close', event => {
      targetWs.close();
    });
    
    targetWs.addEventListener('close', event => {
      server.close();
    });
    
    // 错误处理
    server.addEventListener('error', () => targetWs.close());
    targetWs.addEventListener('error', () => server.close());
    
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
    
  } catch (error) {
    return new Response('Proxy Error', { status: 500 });
  }
}

/**
 * 处理 HTTP 请求
 */
async function handleHttpRequest(request, url) {
  // 状态页面
  if (url.pathname === '/') {
    return new Response(getStatusPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  // 健康检查
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      target: TARGET_HOST,
      ws_path: WS_PATH,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  // 代理其他请求
  try {
    const targetUrl = `https://${TARGET_HOST}${url.pathname}${url.search}`;
    return await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
  } catch (error) {
    return new Response('Proxy Failed', { status: 500 });
  }
}

/**
 * 状态页面
 */
function getStatusPage() {
  return `<!DOCTYPE html>
<html>
<head>
    <title>WebSocket Proxy</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f8f9fa; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; margin-bottom: 20px; }
        .status { color: #27ae60; font-weight: 600; font-size: 18px; margin-bottom: 20px; }
        .info-box { background: #ecf0f1; padding: 20px; border-radius: 8px; margin: 15px 0; }
        .code { font-family: 'Monaco', 'Menlo', monospace; background: #34495e; color: #ecf0f1; padding: 12px; border-radius: 6px; overflow-x: auto; }
        .highlight { background: #f39c12; color: white; padding: 2px 6px; border-radius: 3px; }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .footer { text-align: center; margin-top: 30px; color: #7f8c8d; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 WebSocket Proxy</h1>
        <div class="status">✅ Proxy is running</div>
        
        <div class="info-box">
            <h3>Configuration</h3>
            <p><strong>Target Server:</strong> ${TARGET_HOST}</p>
            <p><strong>WebSocket Path:</strong> ${WS_PATH}</p>
        </div>
        
        <div class="info-box">
            <h3>Usage</h3>
            <p>Use this WebSocket URL in your client:</p>
            <div class="code">wss://<span class="highlight">[your-pages-domain]</span>${WS_PATH}</div>
        </div>
        
        <div class="info-box">
            <h3>Test Connection</h3>
            <p><a href="/health" target="_blank">Health Check</a></p>
            <button onclick="testWebSocket()" style="background: #3498db; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">Test WebSocket</button>
            <div id="test-result" style="margin-top: 10px;"></div>
        </div>
        
        <div class="footer">
            Powered by Cloudflare Pages
        </div>
    </div>
    
    <script>
        function testWebSocket() {
            const result = document.getElementById('test-result');
            result.innerHTML = '🔄 Testing connection...';
            
            try {
                const ws = new WebSocket('wss://' + location.host + '${WS_PATH}');
                
                ws.onopen = () => {
                    result.innerHTML = '✅ WebSocket connection successful!';
                    result.style.color = '#27ae60';
                    ws.close();
                };
                
                ws.onerror = () => {
                    result.innerHTML = '❌ WebSocket connection failed';
                    result.style.color = '#e74c3c';
                };
                
                ws.onclose = (event) => {
                    if (event.code !== 1000) {
                        result.innerHTML = '⚠️ Connection closed with code: ' + event.code;
                        result.style.color = '#f39c12';
                    }
                };
                
                // 超时处理
                setTimeout(() => {
                    if (ws.readyState === WebSocket.CONNECTING) {
                        ws.close();
                        result.innerHTML = '⏰ Connection timeout';
                        result.style.color = '#f39c12';
                    }
                }, 5000);
                
            } catch (error) {
                result.innerHTML = '❌ Error: ' + error.message;
                result.style.color = '#e74c3c';
            }
        }
    </script>
</body>
</html>`;
}
