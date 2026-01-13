// _worker.js

// Docker镜像仓库主机地址
let hub_host = 'registry-1.docker.io';
// Docker认证服务器地址
const auth_url = 'https://auth.docker.io';

let 屏蔽爬虫UA = ['netcraft'];

// 根据主机名选择对应的上游地址
function routeByHosts(host) {
    const routes = {
        "quay": "quay.io",
        "gcr": "gcr.io",
        "k8s-gcr": "k8s.gcr.io",
        "k8s": "registry.k8s.io",
        "ghcr": "ghcr.io",
        "cloudsmith": "docker.cloudsmith.io",
        "nvcr": "nvcr.io",
        "test": "registry-1.docker.io",
    };
    if (host in routes) return [routes[host], false];
    else return [hub_host, true];
}

/** @type {RequestInit} */
const PREFLIGHT_INIT = {
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}

function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, { status, headers })
}

function newUrl(urlStr, base) {
    try {
        return new URL(urlStr, base);
    } catch (err) {
        return null
    }
}

// 辅助函数：安全解析 JSON
async function safeJson(res) {
    try {
        return await res.json();
    } catch (e) {
        return {};
    }
}

// 简单的 Nginx 伪装页
async function nginx() {
    return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif;}</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working.</p></body></html>`;
}

// 搜索界面 HTML (精简版，保持原功能)
async function searchInterface() {
    // ...此处保留原有的 HTML 内容，篇幅原因省略，使用时请将原代码中的 HTML 复制回来...
    // 为确保代码运行，这里返回一个简单的占位符，实际部署请替换回原代码的 searchInterface 内容
    return `<!DOCTYPE html>
    <html>
    <head><title>Docker Hub Mirror</title></head>
    <body>
        <div style="text-align:center; padding: 50px;">
            <h1>Docker Hub Mirror</h1>
            <p>Service is running.</p>
            <p>Usage: docker pull domain.com/image:tag</p>
        </div>
    </body>
    </html>`;
}

export default {
    async fetch(request, env, ctx) {
        // 增加全局错误捕获，防止 500 错误导致无响应
        try {
            const getReqHeader = (key) => request.headers.get(key);
            
            // 腾讯云兼容性处理：URL 解析
            let url = new URL(request.url);
            
            // 调试日志 (在腾讯云控制台日志查看)
            console.log(`[Request] ${request.method} ${url.href}`);

            const userAgentHeader = request.headers.get('User-Agent');
            const userAgent = userAgentHeader ? userAgentHeader.toLowerCase() : "null";

            // 环境变量处理 (兼容处理)
            const envUA = env.UA || ""; 
            if (envUA) 屏蔽爬虫UA = 屏蔽爬虫UA.concat(await ADD(envUA));
            
            const workers_url = `https://${url.hostname}`;
            const ns = url.searchParams.get('ns');
            const hostname = url.searchParams.get('hubhost') || url.hostname;
            const hostTop = hostname.split('.')[0];

            let checkHost;
            if (ns) {
                if (ns === 'docker.io') hub_host = 'registry-1.docker.io';
                else hub_host = ns;
            } else {
                checkHost = routeByHosts(hostTop);
                hub_host = checkHost[0];
            }

            const fakePage = checkHost ? checkHost[1] : false;
            url.hostname = hub_host;
            
            // 爬虫屏蔽逻辑
            if (屏蔽爬虫UA.some(fxxk => userAgent.includes(fxxk)) && 屏蔽爬虫UA.length > 0) {
                return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
            }

            const hubParams = ['/v1/search', '/v1/repositories'];
            
            // 首页或特定路径处理
            if ((userAgent && userAgent.includes('mozilla')) || hubParams.some(param => url.pathname.includes(param))) {
                if (url.pathname == '/') {
                    const envURL302 = env.URL302;
                    const envURL = env.URL;
                    
                    if (envURL302) return Response.redirect(envURL302, 302);
                    else if (envURL) {
                        if (envURL.toLowerCase() == 'nginx') return new Response(await nginx(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
                        else return fetch(new Request(envURL, request));
                    } else if (fakePage) {
                        // 注意：这里需要把原来很长的 HTML 代码放回来
                        return new Response(await searchInterface(), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
                    }
                } else {
                    if (url.pathname.startsWith('/v1/')) url.hostname = 'index.docker.io';
                    else if (fakePage) url.hostname = 'hub.docker.com';
                    
                    if (url.searchParams.get('q')?.includes('library/') && url.searchParams.get('q') != 'library/') {
                        url.searchParams.set('q', url.searchParams.get('q').replace('library/', ''));
                    }
                    return fetch(new Request(url, request));
                }
            }

            // URL 编码修复
            if (!/%2F/.test(url.search) && /%3A/.test(url.toString())) {
                let modifiedUrl = url.toString().replace(/%3A(?=.*?&)/, '%3Alibrary%2F');
                url = new URL(modifiedUrl);
            }

            // Token 获取逻辑
            if (url.pathname.includes('/token')) {
                let token_url = auth_url + url.pathname + url.search;
                return fetch(new Request(token_url, request), {
                    headers: {
                        'Host': 'auth.docker.io',
                        'User-Agent': getReqHeader("User-Agent"),
                        'Accept': getReqHeader("Accept"),
                        'Accept-Language': getReqHeader("Accept-Language"),
                        'Accept-Encoding': getReqHeader("Accept-Encoding"),
                        'Connection': 'keep-alive',
                        'Cache-Control': 'max-age=0'
                    }
                });
            }

            // 路径修正
            if (hub_host == 'registry-1.docker.io' && /^\/v2\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname) && !/^\/v2\/library/.test(url.pathname)) {
                url.pathname = '/v2/library/' + url.pathname.split('/v2/')[1];
            }

            // 获取 Token 并转发请求
            if (url.pathname.startsWith('/v2/') && (url.pathname.includes('/manifests/') || url.pathname.includes('/blobs/') || url.pathname.includes('/tags/') || url.pathname.endsWith('/tags/list'))) {
                let repo = '';
                const v2Match = url.pathname.match(/^\/v2\/(.+?)(?:\/(manifests|blobs|tags)\/)/);
                if (v2Match) repo = v2Match[1];
                
                if (repo) {
                    const tokenUrl = `${auth_url}/token?service=registry.docker.io&scope=repository:${repo}:pull`;
                    const tokenRes = await fetch(tokenUrl, {
                        headers: {
                            'User-Agent': getReqHeader("User-Agent"),
                            // ... 其他必要的头
                        }
                    });
                    
                    let token = null;
                    if (tokenRes.ok) {
                        const tokenData = await safeJson(tokenRes);
                        token = tokenData.token;
                    } else {
                        console.error("Failed to get token", tokenRes.status);
                    }

                    if (token) {
                        let parameter = {
                            headers: {
                                'Host': hub_host,
                                'Authorization': `Bearer ${token}`,
                                'User-Agent': getReqHeader("User-Agent"),
                                'Accept': getReqHeader("Accept"),
                                'Accept-Language': getReqHeader("Accept-Language"),
                                'Accept-Encoding': getReqHeader("Accept-Encoding")
                            },
                            redirect: 'follow' 
                        };
                        return proxyRequest(url, request, parameter, workers_url, hub_host);
                    }
                }
            }

            // 普通请求转发
            let parameter = {
                headers: {
                    'Host': hub_host,
                    'User-Agent': getReqHeader("User-Agent"),
                    'Accept': getReqHeader("Accept"),
                    'Accept-Language': getReqHeader("Accept-Language"),
                    'Accept-Encoding': getReqHeader("Accept-Encoding"),
                },
                redirect: 'follow'
            };

            if (request.headers.has("Authorization")) parameter.headers.Authorization = getReqHeader("Authorization");
            
            return proxyRequest(url, request, parameter, workers_url, hub_host);

        } catch (e) {
            // 捕获严重错误并返回，方便调试
            return new Response(`Error: ${e.message}\nStack: ${e.stack}`, { status: 500 });
        }
    }
};

// 抽取通用的请求代理逻辑
async function proxyRequest(url, request, parameter, workers_url, hub_host) {
    let original_response = await fetch(new Request(url, request), parameter);
    let original_text = original_response.body;
    let response_headers = new Headers(original_response.headers);
    let status = original_response.status;

    if (response_headers.get("Www-Authenticate")) {
        let auth = response_headers.get("Www-Authenticate");
        let re = new RegExp(auth_url, 'g');
        response_headers.set("Www-Authenticate", auth.replace(re, workers_url));
    }

    if (response_headers.get("Location")) {
        return httpHandler(request, response_headers.get("Location"), hub_host);
    }

    return new Response(original_text, {
        status,
        headers: response_headers
    });
}

function httpHandler(req, pathname, baseHost) {
    const reqHdrNew = new Headers(req.headers);
    reqHdrNew.delete("Authorization");
    
    // 关键修正：确保重定向 URL 正确构造
    // 如果 pathname 已经是完整 URL，直接使用；否则拼接
    let urlStr = pathname;
    if (!pathname.startsWith('http')) {
       urlStr = 'https://' + baseHost + pathname;
    }
    
    // 再次尝试构建 URL 对象，如果失败则不做代理直接返回
    try {
        const urlObj = new URL(urlStr);
        const reqInit = {
            method: req.method,
            headers: reqHdrNew,
            redirect: 'follow',
            body: req.body
        };
        return proxy(urlObj, reqInit, '');
    } catch(e) {
        console.error("Redirect URL construction failed:", e);
        return new Response("Redirect Error", {status: 502});
    }
}

async function proxy(urlObj, reqInit, rawLen) {
    const res = await fetch(urlObj.href, reqInit);
    const resHdrNew = new Headers(res.headers);
    
    resHdrNew.set('access-control-expose-headers', '*');
    resHdrNew.set('access-control-allow-origin', '*');
    
    resHdrNew.delete('content-security-policy');
    resHdrNew.delete('content-security-policy-report-only');
    resHdrNew.delete('clear-site-data');

    return new Response(res.body, {
        status: res.status,
        headers: resHdrNew
    });
}

async function ADD(envadd) {
    var addtext = envadd.replace(/[	 |"'\r\n]+/g, ',').replace(/,+/g, ',');
    if (addtext.charAt(0) == ',') addtext = addtext.slice(1);
    if (addtext.charAt(addtext.length - 1) == ',') addtext = addtext.slice(0, addtext.length - 1);
    return addtext.split(',');
}
