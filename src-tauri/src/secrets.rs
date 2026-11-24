/// API Key 存系统钥匙串（macOS Keychain / Windows Credential Manager），不写配置文件
fn entry(provider: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("inkspire", &format!("provider:{provider}")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_set(provider: String, value: String) -> Result<(), String> {
    let e = entry(&provider)?;
    if value.is_empty() {
        let _ = e.delete_credential();
        return Ok(());
    }
    e.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn secret_get(provider: String) -> Result<Option<String>, String> {
    match entry(&provider)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn secret_delete(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
