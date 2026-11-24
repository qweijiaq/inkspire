use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

#[derive(Deserialize, Clone, Serialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub id: String,
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub messages: Vec<AiMessage>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelsRequest {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiTestRequest {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingsRequest {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub input: Vec<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageRequest {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub prompt: String,
    pub size: String,
    #[serde(default)]
    pub image: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageResult {
    pub b64: Option<String>,
    pub url: Option<String>,
}

fn is_local(provider: &str) -> bool {
    provider == "ollama" || provider == "lmstudio"
}

/// 统一 Base URL：留空用默认；本地服务补齐 /v1；去掉尾部斜杠
fn normalize_base(provider: &str, raw: &str) -> String {
    let mut base = raw.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        base = match provider {
            "anthropic" => "https://api.anthropic.com".to_string(),
            "openai" => "https://api.openai.com/v1".to_string(),
            "deepseek" => "https://api.deepseek.com".to_string(),
            "zhipu" => "https://open.bigmodel.cn/api/paas/v4".to_string(),
            "moonshot" => "https://api.moonshot.cn/v1".to_string(),
            "alibaba" => "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string(),
            "openrouter" => "https://openrouter.ai/api/v1".to_string(),
            "opencode" => "https://opencode.ai/inference/openai/v1".to_string(),
            "opencode-go" => "https://opencode.ai/inference/go/openai/v1".to_string(),
            "opendesign" => "https://amr-link.open-design.ai/v1".to_string(),
            "ollama" => "http://localhost:11434".to_string(),
            "lmstudio" => "http://localhost:1234".to_string(),
            _ => String::new(),
        };
    }
    if is_local(provider) && !base.to_lowercase().ends_with("/v1") {
        base.push_str("/v1");
    }
    base
}

fn thinking_off(provider: &str, model: &str) -> Value {
    let m = model.to_lowercase();
    if provider == "alibaba" && (m.contains("qwen3") || m.contains("qwen4") || m.contains("qwen-flash") || m.contains("qwen-plus") || m.contains("qwen-max")) {
        return json!({ "enable_thinking": false });
    }
    if (provider == "deepseek" || provider == "opencode" || provider == "opencode-go") && m.contains("deepseek") {
        return json!({ "thinking": { "type": "disabled" } });
    }
    json!({})
}

fn chat_url(provider: &str, base: &str) -> String {
    if provider == "anthropic" {
        if base.to_lowercase().ends_with("/v1") {
            format!("{base}/messages")
        } else {
            format!("{base}/v1/messages")
        }
    } else {
        format!("{base}/chat/completions")
    }
}

fn models_url(provider: &str, base: &str) -> String {
    if provider == "anthropic" {
        if base.to_lowercase().ends_with("/v1") {
            format!("{base}/models")
        } else {
            format!("{base}/v1/models")
        }
    } else {
        format!("{base}/models")
    }
}

#[tauri::command]
pub async fn ai_stream(app: AppHandle, req: AiRequest) -> Result<(), String> {
    let id = req.id.clone();
    tauri::async_runtime::spawn(async move {
        match run(app.clone(), req.clone()).await {
            Ok(_) => {
                let _ = app.emit_to("main", "inkspire:ai:done", json!({ "id": id }));
            }
            Err(e) => {
                let _ = app.emit_to(
                    "main",
                    "inkspire:ai:error",
                    json!({ "id": id, "message": e }),
                );
            }
        }
    });
    Ok(())
}

async fn run(app: AppHandle, req: AiRequest) -> Result<(), String> {
    stream_chat(&req, |text| {
        let _ = app.emit_to(
            "main",
            "inkspire:ai:delta",
            json!({ "id": req.id, "delta": text }),
        );
    })
    .await
}

/// 纯传输层：不依赖 Tauri，便于集成测试（cargo test -- --ignored）
async fn stream_chat<F: FnMut(&str)>(req: &AiRequest, mut on_delta: F) -> Result<(), String> {
    let provider = req.provider.as_str();
    let base = normalize_base(provider, &req.base_url);
    if base.is_empty() {
        return Err("还没有配置 Base URL".into());
    }
    let is_anthropic = provider == "anthropic";

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let (url, body, builder) = if is_anthropic {
        let system: String = req
            .messages
            .iter()
            .filter(|m| m.role == "system")
            .map(|m| m.content.clone())
            .collect::<Vec<_>>()
            .join("\n\n");
        let msgs: Vec<Value> = req
            .messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| json!({ "role": m.role, "content": m.content }))
            .collect();
        let mut payload = json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
            "messages": msgs,
            "stream": true
        });
        if !system.is_empty() {
            payload["system"] = json!(system);
        }
        (
            chat_url(provider, &base),
            payload,
            client
                .post(chat_url(provider, &base))
                .header("x-api-key", req.api_key.clone())
                .header("anthropic-version", "2023-06-01")
                .header("anthropic-dangerous-direct-browser-access", "true"),
        )
    } else {
        let mut payload = json!({
            "model": req.model,
            "messages": req.messages,
            "stream": true,
            "temperature": req.temperature,
            "max_tokens": req.max_tokens
        });
        if let (Some(obj), Some(extra)) = (payload.as_object_mut(), thinking_off(provider, &req.model).as_object()) {
            for (k, v) in extra.iter() {
                obj.insert(k.clone(), v.clone());
            }
        }
        let mut b = client.post(chat_url(provider, &base));
        if !req.api_key.is_empty() {
            b = b.bearer_auth(&req.api_key);
        }
        (chat_url(provider, &base), payload, b)
    };
    let _ = &url;

    let res = builder
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("网络错误: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "AI 请求失败 ({status}) {}",
            text.chars().take(300).collect::<String>()
        ));
    }

    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取流失败: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let payload = line.strip_prefix("data:").map(str::trim).unwrap_or(line);
            if payload == "[DONE]" {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(payload) else {
                continue;
            };
            if let Some(message) = payload_error(&value) {
                return Err(message);
            }
            let delta = if is_anthropic {
                if value.get("type").and_then(|v| v.as_str()) == Some("content_block_delta") {
                    value
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                        .map(str::to_string)
                } else {
                    None
                }
            } else {
                value
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|t| t.as_str())
                    .map(str::to_string)
            };
            if let Some(text) = delta {
                if !text.is_empty() {
                    on_delta(&text);
                }
            }
        }
    }
    Ok(())
}

fn payload_error(value: &Value) -> Option<String> {
    let err = if value.get("type").and_then(|v| v.as_str()) == Some("error") {
        value.get("error")
    } else {
        value.get("error")
    }?;
    let message = err
        .as_str()
        .map(str::to_string)
        .or_else(|| err.get("message").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or_else(|| "AI 流式响应返回错误".to_string());
    Some(format!("AI 错误：{message}"))
}

#[tauri::command]
pub async fn ai_test(req: AiTestRequest) -> Result<String, String> {
    let provider = req.provider.as_str();
    let base = normalize_base(provider, &req.base_url);
    if base.is_empty() {
        return Err("还没有配置 Base URL".into());
    }
    let is_anthropic = provider == "anthropic";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let url = chat_url(provider, &base);
    let body = if is_anthropic {
        json!({
            "model": req.model,
            "max_tokens": req.max_tokens.max(16),
            "temperature": req.temperature,
            "messages": [{ "role": "user", "content": "回复两个字：在的" }]
        })
    } else {
        let mut body = json!({
            "model": req.model,
            "messages": [{ "role": "user", "content": "回复两个字：在的" }],
            "stream": false,
            "max_tokens": req.max_tokens.max(20),
            "temperature": req.temperature
        });
        if let (Some(obj), Some(extra)) = (body.as_object_mut(), thinking_off(provider, &req.model).as_object()) {
            for (k, v) in extra.iter() {
                obj.insert(k.clone(), v.clone());
            }
        }
        body
    };
    let mut builder = client.post(url).json(&body);
    if is_anthropic {
        builder = builder
            .header("x-api-key", req.api_key.clone())
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-dangerous-direct-browser-access", "true");
    } else if !req.api_key.is_empty() {
        builder = builder.bearer_auth(&req.api_key);
    }
    let res = builder
        .send()
        .await
        .map_err(|e| format!("连接失败：{e}（可能是网络问题或地址错误）"))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "连接失败 ({status}) {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let value: Value = res.json().await.map_err(|e| format!("响应不是 JSON：{e}"))?;
    if let Some(message) = payload_error(&value) {
        return Err(message);
    }
    let text = if is_anthropic {
        value
            .get("content")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("ok")
    } else {
        value
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|t| t.as_str())
            .unwrap_or("ok")
    };
    Ok(text.to_string())
}

#[tauri::command]
pub async fn ai_image(req: ImageRequest) -> Result<ImageResult, String> {
    let base = normalize_base(&req.provider, &req.base_url);
    if base.is_empty() {
        return Err("还没有配置 Base URL".into());
    }
    if req.prompt.trim().is_empty() {
        return Err("封面提示词为空".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let is_dashscope = req.provider == "alibaba";
    let dash_size = if req.size.is_empty() { "1024*1024".to_string() } else { req.size.replace('x', "*") };
    let (url, body) = if is_dashscope {
        let root = base
            .trim_end_matches("/compatible-mode/v1")
            .trim_end_matches("/compatible-mode")
            .trim_end_matches('/');
        let content = if let Some(image) = req.image.as_ref().filter(|s| !s.trim().is_empty()) {
            json!([{ "image": image }, { "text": req.prompt }])
        } else {
            json!([{ "text": req.prompt }])
        };
        (
            format!("{root}/api/v1/services/aigc/multimodal-generation/generation"),
            json!({
                "model": req.model,
                "input": { "messages": [{ "role": "user", "content": content }] },
                "parameters": {
                    "size": dash_size,
                    "n": 1,
                    "response_format": "b64_json",
                    "prompt_extend": true,
                    "watermark": false
                }
            }),
        )
    } else {
        if req.image.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false) {
            return Err("当前服务商暂不支持参考图编辑，请切换到阿里云百炼".into());
        }
        (
            format!("{base}/images/generations"),
            json!({
                "model": req.model,
                "prompt": req.prompt,
                "size": if req.size.is_empty() { "1024x1024" } else { req.size.as_str() },
                "n": 1,
                "response_format": "b64_json",
                "prompt_extend": true,
                "enable_thinking": false,
                "watermark": false
            }),
        )
    };

    let mut builder = client.post(url).json(&body);
    if !req.api_key.is_empty() {
        builder = builder.bearer_auth(&req.api_key);
    }
    let res = builder.send().await.map_err(|e| format!("网络错误: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "生图失败 ({status}) {}",
            text.chars().take(300).collect::<String>()
        ));
    }
    let value: Value = res.json().await.map_err(|e| e.to_string())?;

    let mut b64: Option<String> = None;
    let mut url_out: Option<String> = None;
    if is_dashscope {
        let image = value
            .get("output")
            .and_then(|v| v.get("choices"))
            .and_then(|v| v.as_array())
            .and_then(|v| v.first())
            .and_then(|v| v.get("message"))
            .and_then(|v| v.get("content"))
            .and_then(|v| v.as_array())
            .and_then(|v| v.iter().find_map(|x| x.get("image").and_then(|i| i.as_str())))
            .ok_or("生图响应缺少 image")?;
        if let Some(rest) = image.strip_prefix("data:") {
            b64 = Some(rest.split_once(',').map(|(_, d)| d.to_string()).unwrap_or_default());
        } else {
            url_out = Some(image.to_string());
        }
    } else {
        let item = value
            .get("data")
            .and_then(|v| v.as_array())
            .and_then(|v| v.first())
            .ok_or("生图响应缺少 data")?;
        b64 = item.get("b64_json").and_then(|v| v.as_str()).map(|s| s.to_string());
        url_out = item.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
    }
    if b64.as_ref().map(|s| s.is_empty()).unwrap_or(true) && url_out.is_none() {
        return Err("生图响应既没有 b64_json 也没有 url".into());
    }
    Ok(ImageResult { b64, url: url_out })
}

#[tauri::command]
pub async fn ai_embeddings(req: EmbeddingsRequest) -> Result<Vec<Vec<f32>>, String> {    if req.provider == "anthropic" {
        return Err("Anthropic 暂不提供 embedding 接口；请切换到阿里云百炼、OpenAI 或本地 Ollama".into());
    }
    if req.input.is_empty() {
        return Ok(Vec::new());
    }
    let base = normalize_base(&req.provider, &req.base_url);
    if base.is_empty() {
        return Err("还没有配置 Base URL".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let body = json!({ "model": req.model, "input": req.input });
    let mut builder = client.post(format!("{base}/embeddings")).json(&body);
    if !req.api_key.is_empty() {
        builder = builder.bearer_auth(&req.api_key);
    }
    let res = builder.send().await.map_err(|e| format!("网络错误: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "embedding 请求失败 ({status}) {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let value: Value = res.json().await.map_err(|e| e.to_string())?;
    let data = value.get("data").and_then(|v| v.as_array()).ok_or("embedding 响应缺少 data")?;
    let mut out = Vec::with_capacity(data.len());
    for item in data {
        let arr = item.get("embedding").and_then(|v| v.as_array()).ok_or("embedding 响应缺少向量")?;
        let vec: Vec<f32> = arr
            .iter()
            .map(|x| x.as_f64().unwrap_or(0.0) as f32)
            .collect();
        if vec.is_empty() {
            return Err("embedding 响应返回空向量".into());
        }
        out.push(vec);
    }
    Ok(out)
}

#[tauri::command]
pub async fn ai_models(req: ModelsRequest) -> Result<Vec<String>, String> {    let provider = req.provider.as_str();
    let base = normalize_base(provider, &req.base_url);
    if base.is_empty() {
        return Err("还没有配置 Base URL".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let url = models_url(provider, &base);
    let mut builder = client.get(&url).header("Accept", "application/json");
    if provider == "anthropic" {
        builder = builder
            .header("x-api-key", req.api_key.clone())
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-dangerous-direct-browser-access", "true");
    } else if !req.api_key.is_empty() {
        builder = builder.bearer_auth(&req.api_key);
    }
    let res = builder.send().await.map_err(|e| format!("网络错误: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "读取模型列表失败 ({status}) {}",
            text.chars().take(200).collect::<String>()
        ));
    }
    let value: Value = res.json().await.map_err(|e| e.to_string())?;
    let mut out: Vec<String> = Vec::new();
    let collect = |arr: &Vec<Value>, out: &mut Vec<String>| {
        for item in arr {
            if let Some(s) = item.as_str() {
                out.push(s.to_string());
            } else if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                out.push(id.to_string());
            } else if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                out.push(name.to_string());
            }
        }
    };
    if let Some(arr) = value.as_array() {
        collect(arr, &mut out);
    } else {
        for key in ["data", "models", "items"] {
            if let Some(arr) = value.get(key).and_then(|v| v.as_array()) {
                collect(arr, &mut out);
                break;
            }
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}


#[cfg(test)]
mod tests {
    use super::*;

    /// 真实接口冒烟测试：需要环境变量提供凭据，默认忽略
    /// INK_TEST_PROVIDER / INK_TEST_BASE / INK_TEST_MODEL / INK_TEST_KEY
    #[test]
    #[ignore]
    fn live_stream() {
        let req = AiRequest {
            id: "test".into(),
            provider: std::env::var("INK_TEST_PROVIDER").unwrap_or_else(|_| "alibaba".into()),
            base_url: std::env::var("INK_TEST_BASE").unwrap_or_default(),
            api_key: std::env::var("INK_TEST_KEY").unwrap_or_default(),
            model: std::env::var("INK_TEST_MODEL").unwrap_or_else(|_| "qwen-plus".into()),
            temperature: 0.3,
            max_tokens: 64,
            messages: vec![AiMessage {
                role: "user".into(),
                content: "只回复两个字：在的".into(),
            }],
        };
        let mut text = String::new();
        let res = tauri::async_runtime::block_on(stream_chat(&req, |delta| text.push_str(delta)));
        println!("LIVE_RESULT ok={:?} text={:?}", res.as_ref().map(|_| ()), text);
        assert!(res.is_ok(), "request failed: {:?}", res.err());
        assert!(!text.trim().is_empty(), "empty stream");
    }
}
