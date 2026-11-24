use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};
use walkdir::WalkDir;

const MAX_FILES: usize = 4000;
const MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Clone)]
pub struct VaultFile {
    pub path: String,
    pub content: String,
    pub modified: i64,
    pub size: u64,
}

#[derive(Serialize)]
pub struct VaultInfo {
    pub root: String,
    pub files: usize,
}

fn settings_vault_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    let txt = fs::read_to_string(dir.join("settings.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&txt).ok()?;
    v.get("vaultPath")
        .and_then(|x| x.as_str())
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
}

pub fn read_content(app: &AppHandle, path: &str) -> Result<String, String> {
    let root = vault_root(app)?;
    let full = safe_join(&root, path)?;
    fs::read_to_string(full).map_err(|e| format!("读取失败: {e}"))
}

pub fn vault_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = settings_vault_path(app).unwrap_or_else(|| {
        dirs::document_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Inkspire")
    });
    fs::create_dir_all(&root).map_err(|e| format!("无法创建 vault 目录: {e}"))?;
    Ok(root)
}

fn safe_asset_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    if !rel.starts_with("assets/") {
        return Err("资源必须放在 assets/ 目录".into());
    }
    let p = Path::new(&rel);
    if p.is_absolute() {
        return Err("只允许 vault 内的相对路径".into());
    }
    for part in rel.split('/') {
        if part == ".." || part.is_empty() {
            return Err("非法路径".into());
        }
    }
    Ok(root.join(p))
}

#[tauri::command]
pub async fn vault_asset_write(app: AppHandle, path: String, data: Vec<u8>) -> Result<String, String> {
    let root = vault_root(&app)?;
    let full = safe_asset_join(&root, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建资源目录失败: {e}"))?;
    }
    fs::write(&full, data).map_err(|e| format!("写入资源失败: {e}"))?;
    Ok(path)
}

#[tauri::command]
pub async fn vault_asset_read(app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    let root = vault_root(&app)?;
    let full = safe_asset_join(&root, &path)?;
    fs::read(&full).map_err(|e| format!("读取资源失败: {e}"))
}

fn safe_join_dir(root: &Path, rel: &str) -> Result<PathBuf, String> {    let rel = rel.replace('\\', "/");
    let p = Path::new(&rel);
    if p.is_absolute() {
        return Err("只允许 vault 内的相对路径".into());
    }
    for part in rel.split('/') {
        if part == ".." || part.is_empty() {
            return Err("非法路径".into());
        }
    }
    Ok(root.join(p))
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {    let rel = rel.replace('\\', "/");
    let p = Path::new(&rel);
    if p.is_absolute() {
        return Err("只允许 vault 内的相对路径".into());
    }
    for part in rel.split('/') {
        if part == ".." || part.is_empty() {
            return Err("非法路径".into());
        }
    }
    if !rel.to_lowercase().ends_with(".md") {
        return Err("只支持 .md 文件".into());
    }
    Ok(root.join(p))
}

fn safe_dir(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    let rel = rel.trim_matches('/');
    let mut out = root.to_path_buf();
    for part in rel.split('/') {
        if part.is_empty() {
            continue;
        }
        if part == ".." || part.starts_with('.') {
            return Err("非法目录".into());
        }
        out.push(part);
    }
    Ok(out)
}

#[tauri::command]
pub async fn vault_dirs(app: AppHandle) -> Result<Vec<String>, String> {
    let root = vault_root(&app)?;
    let mut out: Vec<String> = WalkDir::new(&root)
        .min_depth(1)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && (name.starts_with('.') || name == "node_modules" || name == "target"))
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
        .map(|e| to_posix(&root, e.path()))
        .collect();
    out.sort();
    Ok(out)
}

#[tauri::command]
pub async fn vault_mkdir(app: AppHandle, path: String) -> Result<String, String> {
    let root = vault_root(&app)?;
    let full = safe_dir(&root, &path)?;
    fs::create_dir_all(&full).map_err(|e| format!("创建文件夹失败: {e}"))?;
    Ok(to_posix(&root, &full))
}

fn to_posix(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn vault_root_info(app: AppHandle) -> Result<VaultInfo, String> {
    let root = vault_root(&app)?;
    let files = WalkDir::new(&root)
        .max_depth(8)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| e.path().extension().map(|x| x == "md").unwrap_or(false))
        .count();
    Ok(VaultInfo {
        root: root.to_string_lossy().to_string(),
        files,
    })
}

#[derive(Serialize)]
pub struct VaultSignature {
    pub files: usize,
    pub modified: i64,
    pub bytes: u64,
    pub hash: String,
}

#[tauri::command]
pub async fn vault_signature(app: AppHandle) -> Result<VaultSignature, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::time::UNIX_EPOCH;

    let root = vault_root(&app)?;
    let mut files = 0usize;
    let mut modified = 0i64;
    let mut bytes = 0u64;
    let mut hasher = DefaultHasher::new();
    for entry in WalkDir::new(&root)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir()
                && (name.starts_with('.') || name == "node_modules" || name == "target"))
        })
        .filter_map(|e| e.ok())
    {
        if files >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().map(|x| x != "md").unwrap_or(true) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        files += 1;
        bytes = bytes.saturating_add(meta.len());
        modified = modified.max(mtime);
        rel.hash(&mut hasher);
        mtime.hash(&mut hasher);
        meta.len().hash(&mut hasher);
    }
    Ok(VaultSignature {
        files,
        modified,
        bytes,
        hash: format!("{:x}", hasher.finish()),
    })
}

#[tauri::command]
pub async fn vault_list(app: AppHandle) -> Result<Vec<VaultFile>, String> {
    let root = vault_root(&app)?;
    let mut out = Vec::new();
    for entry in WalkDir::new(&root)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.file_type().is_dir()
                && (name.starts_with('.') || name == "node_modules" || name == "target"))
        })
        .filter_map(|e| e.ok())
    {
        if out.len() >= MAX_FILES {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().map(|x| x != "md").unwrap_or(true) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() > MAX_BYTES {
            continue;
        }
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        out.push(VaultFile {
            path: to_posix(&root, path),
            content,
            modified: modified_ms(&meta),
            size: meta.len(),
        });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

#[tauri::command]
pub async fn vault_read(app: AppHandle, path: String) -> Result<String, String> {
    let root = vault_root(&app)?;
    let full = safe_join(&root, &path)?;
    fs::read_to_string(full).map_err(|e| format!("读取失败: {e}"))
}

#[derive(Serialize)]
pub struct WriteResult {
    pub path: String,
    pub modified: i64,
    pub size: u64,
}

#[tauri::command]
pub async fn vault_write(app: AppHandle, path: String, content: String) -> Result<WriteResult, String> {
    let root = vault_root(&app)?;
    let full = safe_join(&root, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    // 原子写：先写临时文件再 rename，断电不丢已提交内容
    let tmp = full.with_extension("md.tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入失败: {e}"))?;
    fs::rename(&tmp, &full).map_err(|e| format!("保存失败: {e}"))?;
    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
    let modified = modified_ms(&meta);
    // 同步全文索引（失败不影响写盘）
    let _ = crate::index::upsert_doc(&app, &path, &content, modified);
    Ok(WriteResult {
        path,
        modified,
        size: meta.len(),
    })
}

#[tauri::command]
pub async fn vault_delete(app: AppHandle, path: String) -> Result<(), String> {
    let root = vault_root(&app)?;
    let full = safe_join(&root, &path)?;
    fs::remove_file(full).map_err(|e| format!("删除失败: {e}"))?;
    let _ = crate::index::remove_doc(&app, &path);
    crate::doc::forget(&path);
    Ok(())
}

#[tauri::command]
pub async fn vault_rename(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let root = vault_root(&app)?;
    let src = safe_join(&root, &from)?;
    let dst = safe_join(&root, &to)?;
    if dst.exists() {
        return Err("目标文档已存在".into());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("重命名失败: {e}"))?;
    let _ = crate::index::remove_doc(&app, &from);
    crate::doc::forget(&from);
    if let Ok(content) = fs::read_to_string(&dst) {
        let modified = fs::metadata(&dst).map(|m| modified_ms(&m)).unwrap_or(0);
        let _ = crate::index::upsert_doc(&app, &to, &content, modified);
    }
    Ok(())
}

#[tauri::command]
pub async fn vault_rename_dir(app: AppHandle, from: String, to: String) -> Result<(), String> {
    let root = vault_root(&app)?;
    let src = safe_join_dir(&root, &from)?;
    let dst = safe_join_dir(&root, &to)?;
    if !src.is_dir() {
        return Err("要重命名的文件夹不存在".into());
    }
    if dst.exists() {
        return Err("目标文件夹已存在".into());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("重命名文件夹失败: {e}"))?;
    crate::index::remove_prefix(&app, &from)?;
    crate::index::index_rebuild(app.clone()).await?;
    Ok(())
}

#[tauri::command]
pub async fn vault_reveal(app: AppHandle) -> Result<(), String> {
    let root = vault_root(&app)?;
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(root)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
