#[cfg(feature = "sqlite")]
pub mod db;
pub mod events;
pub mod models;
pub mod permissions;
pub mod questions;
pub mod sessions;
pub mod todos;
#[cfg(not(target_arch = "wasm32"))]
pub mod tools;
#[cfg(feature = "wasm")]
pub mod wasm;

#[cfg(feature = "sqlite")]
pub use db::DbStore;
pub use events::{Event, EventLog, PromptQueue};
pub use models::{chat_url_for, find_model, is_free_id, needs_responses_endpoint, supports_anonymous, FreeModel, FREE_MODELS};
pub use permissions::{Decision, PermissionRequest, PermissionStore};
pub use questions::{QuestionItem, QuestionOption, QuestionRequest, QuestionStore};
pub use sessions::{Session, SessionStore};
pub use todos::{TodoItem, TodoStore};
#[cfg(not(target_arch = "wasm32"))]
pub use tools::{apply_patch, tool_bash, tool_read, tool_write, ApplyReport, BashResult, PatchOp, ToolError};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiffStat {
    pub add: u32,
    pub del: u32,
    pub hunks: u32,
    pub score: u32,
}

pub fn analyze_diff(text: &str) -> DiffStat {
    let mut add: u32 = 0;
    let mut del: u32 = 0;
    let mut hunks: u32 = 0;
    for line in text.lines() {
        if line.starts_with("@@") {
            hunks = hunks.saturating_add(1);
        } else if line.starts_with("+++ ") || line.starts_with("--- ") {
        } else if line.starts_with('+') {
            add = add.saturating_add(1);
        } else if line.starts_with('-') {
            del = del.saturating_add(1);
        }
    }
    let changed = add.saturating_add(del);
    let mut score = changed.saturating_mul(2).saturating_add(hunks.saturating_mul(5));
    if score > 100 {
        score = 100;
    }
    DiffStat { add, del, hunks, score }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_add_del_hunks() {
        let text = "@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n+more\n";
        let s = analyze_diff(text);
        assert_eq!(s.add, 2);
        assert_eq!(s.del, 1);
        assert_eq!(s.hunks, 1);
    }

    #[test]
    fn skips_file_headers() {
        let text = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
        let s = analyze_diff(text);
        assert_eq!(s.add, 1);
        assert_eq!(s.del, 1);
        assert_eq!(s.hunks, 1);
    }

    #[test]
    fn empty_is_zero() {
        let s = analyze_diff("");
        assert_eq!(s, DiffStat { add: 0, del: 0, hunks: 0, score: 0 });
    }
}
