const LS = {
  base: "ai-base-url",
  key: "ai-api-key",
  model: "ai-model",
};

export function getAIConfig() {
  return {
    baseUrl: (localStorage.getItem(LS.base) || "").trim(),
    apiKey: (localStorage.getItem(LS.key) || "").trim(),
    model: (localStorage.getItem(LS.model) || "").trim(),
  };
}

export function setAIConfig({ baseUrl, apiKey, model } = {}) {
  if (baseUrl != null) localStorage.setItem(LS.base, String(baseUrl).trim());
  if (apiKey != null) localStorage.setItem(LS.key, String(apiKey).trim());
  if (model != null) localStorage.setItem(LS.model, String(model).trim());
}

export function isConfigured() {
  const cfg = getAIConfig();
  return Boolean(cfg.baseUrl && cfg.model);
}

function chatURL(base) {
  return base.replace(/\/+$/, "") + "/chat/completions";
}

export async function chat({ messages, temperature = 0.3, signal } = {}) {
  const { baseUrl, apiKey, model } = getAIConfig();
  if (!baseUrl) throw new Error("未配置 AI 接口地址");
  if (!model) throw new Error("未配置 AI 模型名");

  let resp;
  try {
    resp = await fetch(chatURL(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}),
      },
      body: JSON.stringify({ model, messages, temperature, stream: false }),
      signal,
    });
  } catch (err) {
    throw new Error(
      "网络请求失败，可能是接口地址错误或浏览器跨域限制: " +
        (err?.message || err),
    );
  }

  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.text()).slice(0, 400);
    } catch {}
    throw new Error(
      `接口返回 ${resp.status} ${resp.statusText}${detail ? ": " + detail : ""}`,
    );
  }

  let data;
  try {
    data = await resp.json();
  } catch {
    throw new Error("接口返回不是合法 JSON");
  }
  const content = data?.choices?.[0]?.message?.content;
  if (content == null) throw new Error("接口返回结构异常");
  return typeof content === "string" ? content : JSON.stringify(content);
}

export async function testConnection(signal) {
  return chat({
    messages: [{ role: "user", content: "回复两个字：在吗" }],
    temperature: 0,
    signal,
  });
}
