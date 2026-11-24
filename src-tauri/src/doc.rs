use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

use crate::vault;

#[derive(Serialize, Clone)]
pub struct BlockView {
    pub kind: String,
    pub level: u8,
    pub line: usize,
    pub start: usize,
    pub end: usize,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct DocSnapshot {
    pub text: String,
    pub revision: u64,
    pub blocks: Vec<BlockView>,
}

#[derive(Serialize, Clone)]
pub struct DocPatch {
    pub revision: u64,
    pub blocks: Vec<BlockView>,
}

#[derive(Deserialize, Clone)]
pub struct TextChange {
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

struct DocState {
    rope: Rope,
    revision: u64,
    blocks: Vec<BlockView>,
}

fn store() -> &'static Mutex<HashMap<String, DocState>> {
    static STORE: OnceLock<Mutex<HashMap<String, DocState>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// 用 pulldown-cmark 建立块索引（当前覆盖标题/代码块/表格/引用）
fn parse_blocks(text: &str) -> Vec<BlockView> {
    let mut out = Vec::new();
    let mut heading: Option<(u8, usize, usize)> = None;
    let mut heading_text = String::new();
    let mut in_code = false;
    let mut code_text = String::new();
    let mut code_start = 0usize;
    let mut in_table = false;
    let mut table_start = 0usize;

    let line_of = |pos: usize| text[..pos.min(text.len())].bytes().filter(|b| *b == b'\n').count() + 1;

    for (event, range) in Parser::new(text).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some((heading_level(level), range.start, range.end));
                heading_text.clear();
            }
            Event::Text(t) | Event::Code(t) => {
                if heading.is_some() {
                    heading_text.push_str(&t);
                } else if in_code {
                    code_text.push_str(&t);
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((level, start, end)) = heading.take() {
                    out.push(BlockView {
                        kind: "heading".into(),
                        level,
                        line: line_of(start),
                        start,
                        end,
                        text: heading_text.trim().to_string(),
                    });
                }
            }
            Event::Start(Tag::CodeBlock(_)) => {
                in_code = true;
                code_text.clear();
                code_start = range.start;
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code = false;
                out.push(BlockView {
                    kind: "code".into(),
                    level: 0,
                    line: line_of(code_start),
                    start: code_start,
                    end: range.end,
                    text: code_text.lines().next().unwrap_or("").chars().take(60).collect(),
                });
            }
            Event::Start(Tag::Table(_)) => {
                in_table = true;
                table_start = range.start;
            }
            Event::End(TagEnd::Table) => {
                in_table = false;
                out.push(BlockView {
                    kind: "table".into(),
                    level: 0,
                    line: line_of(table_start),
                    start: table_start,
                    end: range.end,
                    text: "表格".into(),
                });
            }
            Event::Start(Tag::BlockQuote(_)) => {
                out.push(BlockView {
                    kind: "quote".into(),
                    level: 0,
                    line: line_of(range.start),
                    start: range.start,
                    end: range.end,
                    text: String::new(),
                });
            }
            _ => {}
        }
    }
    let _ = in_table;
    out
}

fn apply_changes(rope: &mut Rope, changes: &[TextChange]) -> Result<(), String> {
    let mut sorted = changes.to_vec();
    sorted.sort_by(|a, b| b.from.cmp(&a.from));
    for c in sorted {
        let total = rope.len_utf16_cu();
        let from16 = c.from.min(total);
        let to16 = c.to.min(total).max(from16);
        let from = rope.utf16_cu_to_char(from16);
        let to = rope.utf16_cu_to_char(to16);
        if from <= to {
            rope.remove(from..to);
            rope.insert(from, &c.insert);
        }
    }
    Ok(())
}

fn snapshot(state: &DocState, with_text: bool) -> DocSnapshot {
    DocSnapshot {
        text: if with_text { state.rope.to_string() } else { String::new() },
        revision: state.revision,
        blocks: state.blocks.clone(),
    }
}

#[tauri::command]
pub async fn doc_open(app: AppHandle, path: String) -> Result<DocSnapshot, String> {
    let content = vault::read_content(&app, &path)?;
    let rope = Rope::from_str(&content);
    let blocks = parse_blocks(&content);
    let mut map = store().lock().map_err(|e| e.to_string())?;
    let state = DocState {
        rope,
        revision: 1,
        blocks,
    };
    let snap = snapshot(&state, true);
    map.insert(path, state);
    Ok(snap)
}

#[tauri::command]
pub async fn doc_apply(
    path: String,
    base_revision: u64,
    changes: Vec<TextChange>,
) -> Result<DocPatch, String> {
    let mut map = store().lock().map_err(|e| e.to_string())?;
    let state = match map.get_mut(&path) {
        Some(s) => s,
        None => return Err("文档未在 Rust 侧打开".into()),
    };
    if base_revision != 0 && state.revision != base_revision {
        return Err(format!("revision mismatch: {} != {}", state.revision, base_revision));
    }
    apply_changes(&mut state.rope, &changes)?;
    state.revision += 1;
    let text = state.rope.to_string();
    state.blocks = parse_blocks(&text);
    Ok(DocPatch {
        revision: state.revision,
        blocks: state.blocks.clone(),
    })
}

#[tauri::command]
pub async fn doc_reset(app: AppHandle, path: String, text: String) -> Result<DocPatch, String> {
    let _ = &app;
    let mut map = store().lock().map_err(|e| e.to_string())?;
    let state = map.entry(path).or_insert_with(|| DocState {
        rope: Rope::new(),
        revision: 1,
        blocks: Vec::new(),
    });
    state.rope = Rope::from_str(&text);
    state.revision += 1;
    state.blocks = parse_blocks(&text);
    Ok(DocPatch {
        revision: state.revision,
        blocks: state.blocks.clone(),
    })
}

#[tauri::command]
pub async fn doc_blocks(path: String) -> Result<Vec<BlockView>, String> {
    let map = store().lock().map_err(|e| e.to_string())?;
    Ok(map.get(&path).map(|s| s.blocks.clone()).unwrap_or_default())
}

pub fn forget(path: &str) {
    if let Ok(mut map) = store().lock() {
        map.remove(path);
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_utf16_changes() {
        let mut rope = Rope::from_str("你好，世界");
        // 替换「世界」两个字符（UTF-16 位置 3..5）
        apply_changes(
            &mut rope,
            &[TextChange {
                from: 3,
                to: 5,
                insert: "Inkspire".into(),
            }],
        )
        .unwrap();
        assert_eq!(rope.to_string(), "你好，Inkspire");
    }

    #[test]
    fn keeps_multiple_changes_in_sync() {
        let mut rope = Rope::from_str("# 标题

正文 abc");
        apply_changes(
            &mut rope,
            &[
                TextChange { from: 2, to: 4, insert: "新标题".into() },
                TextChange { from: 9, to: 12, insert: "XYZ".into() },
            ],
        )
        .unwrap();
        assert_eq!(rope.to_string(), "# 新标题

正文 XYZ");
    }

    #[test]
    fn parses_heading_blocks() {
        let blocks = parse_blocks("# 一级

正文

## 二级

```js
const x = 1
```
");
        let headings: Vec<_> = blocks.iter().filter(|b| b.kind == "heading").collect();
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[0].text, "一级");
        assert_eq!(headings[1].line, 5);
        assert!(blocks.iter().any(|b| b.kind == "code"));
    }
}
