const COOKIE = "__Host-staging_gate";
const LOGIN = "/__staging/login";
const LOGOUT = "/__staging/logout";
const TTL = 8 * 60 * 60;
const encoder = new TextEncoder();

function base64(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}
function key(secret, purpose = "session") {
  // Distinct HMAC keys prevent password checks and session signatures sharing a domain.
  return crypto.subtle.importKey("raw", encoder.encode(`staging-gate:${purpose}\u0000${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function protectedResponse(response) {
  // Clone headers, not the body: upstream streaming and Set-Cookie are preserved.
  const result = new Response(response.body, response);
  result.headers.set("Cache-Control", "no-store");
  result.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("Referrer-Policy", "no-referrer");
  return result;
}
function reply(message, status, headers = {}) {
  return protectedResponse(new Response(message, { status, headers }));
}
function redirect(path, cookie) {
  return reply(null, 303, { Location: path, ...(cookie ? { "Set-Cookie": cookie } : {}) });
}
function cookie(value, lifetime = TTL) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${lifetime}; Secure; HttpOnly; SameSite=Strict`;
}
function page(logout = false) {
  const nonce = base64(crypto.getRandomValues(new Uint8Array(18)));
  const title = logout ? "테스트 사이트에서 나가기" : "동네책방 테스트 공간";
  const form = logout ? `<p>테스트 사이트 입장 세션을 이 브라우저에서 종료합니다.</p><form method="post" action="${LOGOUT}"><button>로그아웃</button></form>`
    : `<p>운영 서비스와 분리된 테스트 공간입니다.</p><form method="post" action="${LOGIN}"><label for="password">테스트 공간 입장 암호</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="512" autofocus><p>관리자가 설정한 16자 이상의 입장 암호를 입력해 주세요. 기존 작업자 암호와 다릅니다.</p><button>입장하기</button></form>`;
  const script = `const form=document.querySelector('form');const button=form.querySelector('button');const label=button.textContent;window.addEventListener('pageshow',()=>{button.disabled=false;button.textContent=label;document.getElementById('status').textContent='';});form.addEventListener('submit',()=>{button.disabled=true;button.textContent='처리 중…';document.getElementById('status').textContent='잠시만 기다려 주세요.';});`;
  return reply(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style nonce="${nonce}">body{font:16px/1.6 system-ui;margin:0;background:#f6f3ee;color:#302f2b}main{max-width:420px;margin:12vh auto;padding:28px}input,button{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;font:inherit}button{background:#645b46;color:white;border:0;border-radius:8px}button:disabled{opacity:.6}p{color:#605c54}input{border:1px solid #aaa;border-radius:8px}</style></head><body><main><h1>${title}</h1>${form}<p id="status" role="status" aria-live="polite"></p></main><script nonce="${nonce}">${script}</script></body></html>`, 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  });
}

async function boundedForm(request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") throw Object.assign(new Error("Invalid form"), { status: 415 });
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2048) { await reader.cancel(); throw Object.assign(new Error("Large form"), { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function validSession(request, secret, timestamp) {
  const cookies = (request.headers.get("cookie") || "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${COOKIE}=`));
  if (cookies.length !== 1) return false;
  const value = cookies[0].slice(COOKIE.length + 1);
  if (value.length > 2048) return false;
  try {
    const parts = value.split(".");
    if (parts.length !== 2) return false;
    const [payload, signature] = parts;
    if (!await crypto.subtle.verify("HMAC", await key(secret), decode(signature), encoder.encode(payload))) return false;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    return data.v === 1 && data.host === new URL(request.url).host && Number.isInteger(data.iat) && Number.isInteger(data.exp)
      && data.iat <= timestamp && data.exp > timestamp && data.exp - data.iat === TTL
      && typeof data.nonce === "string" && /^[A-Za-z0-9_-]{24}$/.test(data.nonce);
  } catch { return false; }
}

/** Fail-closed wrapper; never used by the existing Sites deployment entry. */
export function createStagingGate(next, { now = Date.now } = {}) {
  return {
    async fetch(request, env, ctx) {
      try {
        const password = env?.STAGING_ACCESS_PASSWORD;
        const secret = env?.STAGING_SESSION_SECRET;
        if (env?.APP_ENV !== "staging" || typeof password !== "string" || password.trim().length < 16 || password.length > 512
          || typeof secret !== "string" || secret.trim().length < 32 || secret.length > 1024 || password === secret) return reply("테스트 접근 보호 설정이 필요합니다.", 503);
        const url = new URL(request.url);
        if (url.protocol !== "https:") return reply("HTTPS 연결이 필요합니다.", 400);
        const timestamp = Math.floor(now() / 1000);
        if (url.pathname === LOGIN || url.pathname === LOGOUT) {
          if (request.method === "GET") return page(url.pathname === LOGOUT);
          if (request.method !== "POST") return reply("허용되지 않는 요청입니다.", 405, { Allow: "GET, POST" });
          if (request.headers.get("origin") !== url.origin) return reply("요청 출처를 확인할 수 없습니다.", 403);
          let form;
          try { form = await boundedForm(request); } catch (error) { return reply("올바른 입력 형식이 아닙니다.", error.status || 400); }
          if (url.pathname === LOGOUT) {
            if ([...form].length) return reply("올바른 입력 형식이 아닙니다.", 400);
            return redirect(LOGIN, cookie("", 0));
          }
          if (form.getAll("password").length !== 1 || [...form.keys()].some((name) => name !== "password")) return reply("올바른 입력 형식이 아닙니다.", 400);
          const ip = request.headers.get("CF-Connecting-IP");
          if (!ip || typeof env.STAGING_LOGIN_LIMITER?.limit !== "function") return reply("로그인 보호 서비스를 사용할 수 없습니다.", 503);
          let limit;
          try { limit = await env.STAGING_LOGIN_LIMITER.limit({ key: `staging-login:${ip}` }); } catch { return reply("로그인 보호 서비스를 사용할 수 없습니다.", 503); }
          if (limit?.success === false) return reply("로그인 시도가 많습니다. 1분 후 다시 시도해 주세요.", 429, { "Retry-After": "60" });
          if (limit?.success !== true) return reply("로그인 보호 서비스를 사용할 수 없습니다.", 503);
          const passwordKey = await key(secret, "password-check");
          const expected = await crypto.subtle.sign("HMAC", passwordKey, encoder.encode(password));
          if (!await crypto.subtle.verify("HMAC", passwordKey, expected, encoder.encode(form.get("password")))) return reply("입장 암호가 맞지 않습니다. 뒤로 돌아가 다시 입력해 주세요.", 401);
          const payload = base64(encoder.encode(JSON.stringify({ v: 1, host: url.host, iat: timestamp, exp: timestamp + TTL, nonce: base64(crypto.getRandomValues(new Uint8Array(18))) })));
          const signature = base64(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))));
          return redirect("/", cookie(`${payload}.${signature}`));
        }
        if (!await validSession(request, secret, timestamp)) {
          const html = request.headers.get("accept")?.includes("text/html");
          const resource = url.pathname === "/api" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/_") || /\.[^/]+$/.test(url.pathname);
          return request.method === "GET" && html && !resource && !request.headers.get("upgrade") ? redirect(LOGIN) : reply("테스트 공간 입장이 필요합니다.", 401);
        }
        if (url.pathname === "/_vinext/image" || url.pathname.startsWith("/_vinext/image/")) return reply("Not found", 404);
        const headers = new Headers(request.headers);
        const otherCookies = (headers.get("cookie") || "").split(";").map((part) => part.trim()).filter((part) => !part.startsWith(`${COOKIE}=`)).join("; ");
        if (otherCookies) headers.set("cookie", otherCookies); else headers.delete("cookie");
        return protectedResponse(await next.fetch(new Request(request, { headers }), env, ctx));
      } catch { return reply("테스트 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500); }
    },
  };
}
