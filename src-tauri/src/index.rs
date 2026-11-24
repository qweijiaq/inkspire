use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub line: usize,
    pub snippet: String,
    pub score: f64,
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("index.sqlite3"))
}

fn connect(app: &AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(db_path(app)?).map_err(|e| format!("打开索引失败: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("设置索引超时失败: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS docs (
            path TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            updated_at INTEGER NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    // trigram 分词支持中文子串；旧版 SQLite 不支持时退回默认分词
    if conn
        .execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(path UNINDEXED, title, body, tokenize='trigram');",
        )
        .is_err()
    {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(path UNINDEXED, title, body);",
        )
        .map_err(|e| format!("创建全文索引失败: {e}"))?;
    }
    Ok(conn)
}

fn guess_title(path: &str, content: &str) -> String {
    // Front Matter title
    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            for line in rest[..end].lines() {
                if let Some(v) = line.trim().strip_prefix("title:") {
                    let t = v.trim().trim_matches('"').trim_matches('\'').trim();
                    if !t.is_empty() {
                        return t.to_string();
                    }
                }
            }
        }
    }
    for line in content.lines() {
        if let Some(t) = line.strip_prefix("# ") {
            let t = t.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    path.rsplit('/')
        .next()
        .unwrap_or(path)
        .trim_end_matches(".md")
        .to_string()
}

fn strip_front_matter(content: &str) -> &str {
    if let Some(rest) = content.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let body_start = end + 4;
            if let Some(rest2) = rest.get(body_start..) {
                return rest2.trim_start_matches('\n');
            }
        }
    }
    content
}

pub fn upsert_doc(app: &AppHandle, path: &str, content: &str, modified: i64) -> Result<(), String> {
    // 归档目录不参与搜索，避免旧种子文档又被搜出来。
    if path.starts_with(".trash/") {
        return Ok(());
    }
    let title = guess_title(path, content);
    let body = strip_front_matter(content).to_string();
    let mut conn = connect(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO docs(path,title,body,updated_at) VALUES(?1,?2,?3,?4)
         ON CONFLICT(path) DO UPDATE SET title=excluded.title, body=excluded.body, updated_at=excluded.updated_at",
        params![path, title, body, modified],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM docs_fts WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO docs_fts(path,title,body) VALUES(?1,?2,?3)",
        params![path, title, body],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn remove_doc(app: &AppHandle, path: &str) -> Result<(), String> {
    let mut conn = connect(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM docs WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM docs_fts WHERE path = ?1", params![path])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn remove_prefix(app: &AppHandle, prefix: &str) -> Result<(), String> {
    let mut conn = connect(app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let escaped = prefix
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let like = format!("{escaped}/%");
    tx.execute(
        "DELETE FROM docs WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
        params![prefix, like],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM docs_fts WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
        params![prefix, like],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn index_rebuild(app: AppHandle) -> Result<usize, String> {
    let files = crate::vault::vault_list(app.clone()).await?;
    let mut n = 0;
    for f in files {
        upsert_doc(&app, &f.path, &f.content, f.modified)?;
        n += 1;
    }
    Ok(n)
}

#[tauri::command]
pub async fn index_upsert(app: AppHandle, path: String, content: String, modified: i64) -> Result<(), String> {
    upsert_doc(&app, &path, &content, modified)
}

#[tauri::command]
pub async fn index_remove(app: AppHandle, path: String) -> Result<(), String> {
    remove_doc(&app, &path)
}

fn snippet_for(body: &str, token: &str) -> (usize, String) {
    let needle = token.to_lowercase();
    for (i, line) in body.lines().enumerate() {
        if line.to_lowercase().contains(&needle) {
            let t = line.trim();
            let s: String = t.chars().take(160).collect();
            return (i, s);
        }
    }
    (0, body.chars().take(160).collect())
}

fn like_search(conn: &Connection, tokens: &[String], limit: i64) -> Result<Vec<SearchHit>, String> {
    let mut sql = String::from("SELECT path,title,body FROM docs WHERE 1=1");
    for _ in tokens {
        sql.push_str(" AND body LIKE ?");
    }
    sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    for t in tokens {
        args.push(Box::new(format!("%{}%", t)));
    }
    args.push(Box::new(limit));
    let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(refs.as_slice(), |row| {
            let path: String = row.get(0)?;
            let title: String = row.get(1)?;
            let body: String = row.get(2)?;
            Ok((path, title, body))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let (path, title, body) = r.map_err(|e| e.to_string())?;
        let (line, snippet) = snippet_for(&body, &tokens[0]);
        out.push(SearchHit { path, title, line, snippet, score: 1.0 });
    }
    Ok(out)
}

fn fts_search(conn: &Connection, tokens: &[String], limit: i64) -> Result<Vec<SearchHit>, String> {
    let expr = tokens
        .iter()
        .map(|t| format!("\"{}\"", t.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" AND ");
    let mut stmt = conn
        .prepare(
            "SELECT d.path, d.title, d.body, bm25(docs_fts) AS rank
             FROM docs_fts JOIN docs d ON d.path = docs_fts.path
             WHERE docs_fts MATCH ?1
             ORDER BY rank LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![expr, limit], |row| {
            let path: String = row.get(0)?;
            let title: String = row.get(1)?;
            let body: String = row.get(2)?;
            let rank: f64 = row.get(3).unwrap_or(0.0);
            Ok((path, title, body, rank))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        let (path, title, body, rank) = r.map_err(|e| e.to_string())?;
        let (line, snippet) = snippet_for(&body, &tokens[0]);
        out.push(SearchHit { path, title, line, snippet, score: -rank });
    }
    Ok(out)
}

#[tauri::command]
pub async fn search_docs(app: AppHandle, query: String, limit: Option<i64>) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let conn = connect(&app)?;
    let tokens: Vec<String> = q.split_whitespace().map(|s| s.to_string()).collect();
    let limit = limit.unwrap_or(50);
    let all_long = tokens.iter().all(|t| t.chars().count() >= 3);
    let hits = if all_long {
        fts_search(&conn, &tokens, limit).or_else(|_| like_search(&conn, &tokens, limit))?
    } else {
        like_search(&conn, &tokens, limit)?
    };
    Ok(hits)
}
