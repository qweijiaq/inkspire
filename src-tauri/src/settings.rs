use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub async fn settings_load(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let txt = fs::read_to_string(path).map_err(|e| format!("读取设置失败: {e}"))?;
    Ok(Some(txt))
}

#[tauri::command]
pub async fn settings_save(app: AppHandle, json: String) -> Result<(), String> {
    // 必须是合法 JSON，避免写坏配置文件
    let _: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("设置格式错误: {e}"))?;
    let path = settings_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json.as_bytes()).map_err(|e| format!("写入设置失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存设置失败: {e}"))?;
    Ok(())
}
