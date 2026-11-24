use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager, WebviewWindow};
use walkdir::WalkDir;

const MAX_FILES: usize = 4000;
const MAX_BYTES: u64 = 4 * 1024 * 1024;

fn ensure_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("这个操作只允许主窗口调用".into())
    }
}

/// 同一进程内串行写盘，避免两个命令同时 rename 同一路径。
static WRITE_LOCK: Mutex<()> = Mutex::new(());
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

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

fn settings_vault_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位设置目录: {e}"))?;
    let file = dir.join("settings.json");
    if !file.exists() {
        return Ok(None);
    }
    let txt = fs::read_to_string(&file).map_err(|e| format!("读取设置失败: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&txt).map_err(|e| format!("设置文件损坏，已停止写入以避免串库: {e}"))?;
    Ok(v.get("vaultPath")
        .and_then(|x| x.as_str())
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from))
}

/// 从 root 开始逐段检查，拒绝路径中的符号链接（包括 assets/ 被替换成链接）。
fn reject_symlinks(root: &Path, rel: &str) -> Result<(), String> {
    let mut cur = root.to_path_buf();
    for part in rel.replace('\\', "/").split('/') {
        if part.is_empty() || part == ".." {
            return Err("非法路径".into());
        }
        cur.push(part);
        if let Ok(meta) = fs::symlink_metadata(&cur) {
            if meta.file_type().is_symlink() {
                return Err("不允许通过符号链接访问 vault 外部".into());
            }
        }
    }
    Ok(())
}

pub fn read_content(app: &AppHandle, path: &str) -> Result<String, String> {
    let root = vault_root(app)?;
    let full = safe_join(&root, path)?;
    fs::read_to_string(full).map_err(|e| format!("读取失败: {e}"))
}

pub fn vault_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = settings_vault_path(app)?.unwrap_or_else(|| {
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
    reject_symlinks(root, &rel)?;
    Ok(root.join(p))
}

#[tauri::command]
pub async fn vault_asset_write(window: WebviewWindow, app: AppHandle, path: String, data: Vec<u8>) -> Result<String, String> {
    ensure_main(&window)?;
    let root = vault_root(&app)?;
    let full = safe_asset_join(&root, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建资源目录失败: {e}"))?;
    }
    fs::write(&full, data).map_err(|e| format!("写入资源失败: {e}"))?;
    Ok(path)
}

#[tauri::command]
pub async fn vault_asset_read(window: WebviewWindow, app: AppHandle, path: String) -> Result<Vec<u8>, String> {
    ensure_main(&window)?;
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
    reject_symlinks(root, &rel)?;
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
    reject_symlinks(root, &rel)?;
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
    let rel = rel.trim_matches('/');
    reject_symlinks(root, rel)?;
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
pub async fn vault_mkdir(window: WebviewWindow, app: AppHandle, path: String) -> Result<String, String> {
    ensure_main(&window)?;
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
pub async fn vault_read(window: WebviewWindow, app: AppHandle, path: String) -> Result<String, String> {
    ensure_main(&window)?;
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
pub async fn vault_write(window: WebviewWindow, app: AppHandle, path: String, content: String) -> Result<WriteResult, String> {
    ensure_main(&window)?;
    let root = vault_root(&app)?;
    let full = safe_join(&root, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    // 原子写：唯一临时名 + 进程内串行，避免并发保存互相覆盖 tmp。
    let _guard = WRITE_LOCK.lock().map_err(|_| "写盘锁已损坏".to_string())?;
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let stamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = full.with_extension(format!("md.{stamp}.{seq}.tmp"));
    // create_new 拒绝已存在的路径，避免临时名被预先替换成符号链接。
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| format!("创建临时文件失败: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("写入失败: {e}"))?;
    file.sync_all().map_err(|e| format!("刷盘失败: {e}"))?;
    drop(file);
    fs::rename(&tmp, &full).map_err(|e| format!("保存失败: {e}"))?;
    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
    let modified = modified_ms(&meta);
    // 同步全文索引（失败不影响写盘，但必须留日志，不能静默落后）
    if let Err(e) = crate::index::upsert_doc(&app, &path, &content, modified) {
        eprintln!("[index] upsert failed for {path}: {e}");
    }
    Ok(WriteResult {
        path,
        modified,
        size: meta.len(),
    })
}

#[tauri::command]
pub async fn vault_delete(window: WebviewWindow, app: AppHandle, path: String) -> Result<(), String> {
    ensure_main(&window)?;
    let root = vault_root(&app)?;
    let full = safe_join(&root, &path)?;
    fs::remove_file(full).map_err(|e| format!("删除失败: {e}"))?;
    if let Err(e) = crate::index::remove_doc(&app, &path) {
        eprintln!("[index] remove failed for {path}: {e}");
    }
    crate::doc::forget(&path);
    Ok(())
}

#[tauri::command]
pub async fn vault_rename(window: WebviewWindow, app: AppHandle, from: String, to: String) -> Result<(), String> {
    ensure_main(&window)?;
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
    if let Err(e) = crate::index::remove_doc(&app, &from) {
        eprintln!("[index] remove failed for {from}: {e}");
    }
    crate::doc::forget(&from);
    if let Ok(content) = fs::read_to_string(&dst) {
        let modified = fs::metadata(&dst).map(|m| modified_ms(&m)).unwrap_or(0);
        if let Err(e) = crate::index::upsert_doc(&app, &to, &content, modified) {
            eprintln!("[index] upsert failed for {to}: {e}");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn vault_delete_dir(window: WebviewWindow, app: AppHandle, path: String) -> Result<(), String> {
    ensure_main(&window)?;
    let root = vault_root(&app)?;
    let rel = path.trim_matches('/').replace('\\', "/");
    if rel.is_empty() || rel.split('/').any(|p| p.is_empty() || p == ".." || p.starts_with('.')) {
        return Err("非法文件夹路径".into());
    }
    let src = safe_dir(&root, &rel)?;
    if !src.exists() {
        return Ok(());
    }
    // 删除文件夹采用归档，不直接 remove_dir_all：用户误删时还能从 .trash 找回。
    let name = src.file_name().and_then(|x| x.to_str()).unwrap_or("folder");
    let stamp = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let archive_root = root.join(".trash").join("folders");
    fs::create_dir_all(&archive_root).map_err(|e| format!("创建归档目录失败: {e}"))?;
    let archive = archive_root.join(format!("{stamp}-{name}"));
    fs::rename(&src, &archive).map_err(|e| format!("归档文件夹失败: {e}"))?;
    if let Err(e) = crate::index::remove_prefix(&app, &rel) {
        eprintln!("[index] remove_prefix failed for {rel}: {e}");
    }
    crate::doc::forget_prefix(&rel);
    Ok(())
}

#[tauri::command]
pub async fn vault_rename_dir(window: WebviewWindow, app: AppHandle, from: String, to: String) -> Result<(), String> {
    ensure_main(&window)?;
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
pub async fn vault_reveal(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main(&window)?;
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
