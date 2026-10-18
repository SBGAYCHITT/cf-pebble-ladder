// ============================================================
// Dev-Sidecar「增强功能」服务端 —— Cloudflare Workers 版（免费·不绑卡）
// 原理：DS 把请求改写成 https://你的域名/前缀/目标域名/路径 发过来，
//       本脚本抽出目标域名去境外抓取再回传。
// ============================================================

// ====== 只改下面这两行 ======
const PREFIX   = "xxxxxxxx";   // 改成你自己随手敲的一串字母，当密码用，千万别公开
const PASSWORD = "你的密码";    // 不想设密码就留空字符串 ""（但强烈建议设一个）
// =============================

export default {
  async fetch(request) {
    return await handle(request);
  }
}

async function handle(req) {
  // 1. 密码校验（防被扫成开放代理）
  const pw = req.headers.get("dspassword");
  if (PASSWORD && pw !== PASSWORD) {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(req.url);
  const prefixPath = "/" + PREFIX + "/";

  // 2. 必须是带前缀的路径，否则 404（规避钓鱼试探）
  if (!url.pathname.startsWith(prefixPath)) {
    return new Response("Not Found", { status: 404 });
  }

  // 3. 抽出目标： /PREFIX/HOST/URI
  const rest = url.pathname.slice(prefixPath.length);
  const slashIdx = rest.indexOf("/");
  let host, uri;
  if (slashIdx === -1) {
    host = rest;
    uri = "/";
  } else {
    host = rest.slice(0, slashIdx);
    uri = "/" + rest.slice(slashIdx + 1);
  }
  const targetUrl = "https://" + host + uri + url.search;

  // 4. 构造转发请求头（去掉 hop-by-hop 和 dspassword、host）
  const headers = new Headers();
  for (const [k, v] of req.headers.entries()) {
    const lk = k.toLowerCase();
    if (["host", "dspassword", "connection", "content-length",
         "cf-connecting-ip", "cf-ray", "cf-visitor", "x-forwarded-for", "x-real-ip"]
        .includes(lk)) continue;
    headers.set(k, v);
  }
  const init = { method: req.method, headers: headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = req.body;

  // 5. 抓取目标站点
  let resp;
  try {
    resp = await fetch(targetUrl, init);
  } catch (e) {
    return new Response("Bad Gateway: " + e.message, { status: 502 });
  }

  // 6. 重写 3xx 重定向 Location，指回 worker 路径（否则跳转会绕过代理）
  const outHeaders = new Headers(resp.headers);
  outHeaders.delete("content-length");
  outHeaders.delete("transfer-encoding");
  const loc = outHeaders.get("location");
  if (loc && resp.status >= 300 && resp.status < 400) {
    try {
      const lu = new URL(loc);
      outHeaders.set("location", prefixPath + lu.host + lu.pathname + lu.search + lu.hash);
    } catch (e) {
      // 相对路径兜底
      outHeaders.set("location", prefixPath + host + (loc.startsWith("/") ? loc : "/" + loc));
    }
  }

  return new Response(resp.body, { status: resp.status, headers: outHeaders });
}
