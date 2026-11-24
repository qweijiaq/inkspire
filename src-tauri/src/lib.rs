mod ai;
mod doc;
mod index;
mod secrets;
mod settings;
mod vault;

use serde_json::json;
use tauri::{Emitter, LogicalPosition, Manager};

#[tauri::command]
fn pet_open(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("pet") {
        // 跟随主窗口所在显示器，而不是系统主屏（多显示器时不会跑到别的屏中间）
        let monitor = app
            .get_webview_window("main")
            .and_then(|m| m.current_monitor().ok().flatten())
            .or_else(|| win.current_monitor().ok().flatten())
            .or_else(|| win.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let pos = monitor.position();
            let x = pos.x as f64 / scale + size.width as f64 / scale - 240.0 - 18.0;
            let y = pos.y as f64 / scale + size.height as f64 / scale - 300.0 - 48.0;
            let _ = win.set_position(LogicalPosition::new(x, y));
        }
        win.show().map_err(|e| e.to_string())?;
        let _ = win.set_always_on_top(false);
    }
    Ok(())
}

#[tauri::command]
fn pet_close(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("pet") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pet_mood(app: tauri::AppHandle, mood: String, line: Option<String>) -> Result<(), String> {
    app.emit_to("pet", "inkspire:pet:state", json!({ "mood": mood, "line": line }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_export(name: String, data: Vec<u8>) -> Result<String, String> {
    let dir = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .ok_or("找不到下载目录")?
        .join("Inkspire");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' { '_' } else { c })
        .collect();
    let path = dir.join(if safe.trim().is_empty() { "export".into() } else { safe });
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("只允许打开 http(s) 链接".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pet_activate(app: tauri::AppHandle) -> Result<(), String> {
    app.emit_to("main", "inkspire:pet:activate", json!({}))
        .map_err(|e| e.to_string())?;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}

/// 演示模式：把窗口提升到所有空间 + 全屏辅助层，方便在全屏应用上直接看到
#[cfg(target_os = "macos")]
fn demo_float(win: &tauri::WebviewWindow) {
    if std::env::var("INKSPIRE_DEMO_FLOAT").is_err() {
        return;
    }
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    if let Ok(ptr) = win.ns_window() {
        unsafe {
            let ns = &*(ptr as *const AnyObject);
            // NSWindowCollectionBehaviorCanJoinAllSpaces | FullScreenAuxiliary
            let behavior: usize = 1 | (1 << 8);
            let _: () = msg_send![ns, setCollectionBehavior: behavior];
            // NSFloatingWindowLevel
            let _: () = msg_send![ns, setLevel: 3i64];
            let _: () = msg_send![ns, orderFrontRegardless];
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn demo_float(_win: &tauri::WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            if let Some(main) = app.get_webview_window("main") {
                let h = handle.clone();
                main.on_window_event(move |event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        h.exit(0);
                    }
                });
                let _ = main.show();
                let _ = main.set_focus();
                demo_float(&main);
            }
            if let Some(pet) = app.get_webview_window("pet") {
                demo_float(&pet);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault::vault_root_info,
            vault::vault_dirs,
            vault::vault_mkdir,
            vault::vault_list,
            vault::vault_read,
            vault::vault_write,
            vault::vault_delete,
            vault::vault_rename,
            vault::vault_rename_dir,
            vault::vault_signature,
            vault::vault_asset_write,
            vault::vault_asset_read,
            vault::vault_reveal,
            settings::settings_load,
            settings::settings_save,
            ai::ai_stream,
            ai::ai_test,
            ai::ai_models,
            ai::ai_embeddings,
            ai::ai_image,
            doc::doc_open,
            doc::doc_apply,
            doc::doc_reset,
            doc::doc_blocks,
            index::index_rebuild,
            index::index_upsert,
            index::index_remove,
            index::search_docs,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            pet_open,
            pet_close,
            pet_mood,
            save_export,
            open_path,
            open_external,
            pet_activate
        ])
        .run(tauri::generate_context!())
        .expect("error while running Inkspire");
}
