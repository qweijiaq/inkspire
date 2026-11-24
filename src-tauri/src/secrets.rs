use tauri::WebviewWindow;

/// 密钥命令只允许主窗口调用，桌宠窗口没有理由读取任何 provider 的 Key。
fn ensure_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("密钥命令只允许主窗口调用".into())
    }
}

/// API Key 存系统钥匙串（macOS Keychain / Windows Credential Manager），不写配置文件
fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("inkspire", &format!("provider:{provider}")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_set(window: WebviewWindow, provider: String, value: String) -> Result<(), String> {
    ensure_main(&window)?;
    let e = entry(&provider)?;
    if value.is_empty() {
        let _ = e.delete_credential();
        return Ok(());
    }
    e.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_get(window: WebviewWindow, provider: String) -> Result<Option<String>, String> {
    ensure_main(&window)?;
    match entry(&provider)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn secret_delete(window: WebviewWindow, provider: String) -> Result<(), String> {
    ensure_main(&window)?;
    match entry(&provider)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
