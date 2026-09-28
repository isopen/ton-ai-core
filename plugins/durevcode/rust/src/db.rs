use rusqlite::{params, Connection, Result};
use crate::events::Event;
use crate::permissions::{Decision, PermissionRequest};
use crate::questions::{decode_line as decode_question, encode_line as encode_question, QuestionItem, QuestionRequest};
use crate::sessions::Session;
use crate::todos::TodoItem;

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    directory TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    created INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
    key TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    time INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session);
CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT '',
    resource TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS resolved_perms (
    id TEXT PRIMARY KEY,
    decision TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_permissions_session ON permissions(session);
CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session);
CREATE TABLE IF NOT EXISTS todos (
    session TEXT NOT NULL,
    position INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'medium',
    PRIMARY KEY (session, position)
);
CREATE TABLE IF NOT EXISTS auth (
    user TEXT NOT NULL,
    provider TEXT NOT NULL,
    key TEXT NOT NULL,
    created INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user, provider)
);
";

fn next_id(conn: &Connection, table: &str, col: &str, prefix: &str) -> Result<String> {
    let sql = format!("SELECT {} FROM {} WHERE {} LIKE ?1", col, table, col);
    let mut stmt = conn.prepare(&sql)?;
    let like = format!("{}%", prefix);
    let rows = stmt.query_map(params![like], |row| row.get::<_, String>(0))?;
    let mut max: u32 = 0;
    for r in rows {
        if let Ok(id) = r {
            if let Some(n) = id.strip_prefix(prefix).and_then(|v| v.parse::<u32>().ok()) {
                if n > max {
                    max = n;
                }
            }
        }
    }
    Ok(format!("{}{:04}", prefix, max + 1))
}

pub struct DbStore {
    conn: Connection,
}

impl DbStore {
    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(DbStore { conn })
    }

    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(DbStore { conn })
    }

    pub fn session_exists(&self, id: &str) -> bool {
        self.conn
            .query_row("SELECT 1 FROM sessions WHERE id = ?1", params![id], |_| Ok(()))
            .is_ok()
    }

    pub fn create_session(&self, directory: &str, model: &str, now: u64) -> Result<Session> {
        let id = next_id(&self.conn, "sessions", "id", "ses_")?;
        self.conn.execute(
            "INSERT INTO sessions (id, title, directory, model, created, updated) VALUES (?1, '', ?2, ?3, ?4, ?4)",
            params![id, directory, model, now as i64],
        )?;
        Ok(Session {
            id,
            title: String::new(),
            directory: directory.to_string(),
            model: model.to_string(),
            created: now,
            updated: now,
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, directory, model, created, updated FROM sessions ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Session {
                id: row.get(0)?,
                title: row.get(1)?,
                directory: row.get(2)?,
                model: row.get(3)?,
                created: row.get::<_, i64>(4)? as u64,
                updated: row.get::<_, i64>(5)? as u64,
            })
        })?;
        rows.collect()
    }

    pub fn rename_session(&self, id: &str, title: &str, now: u64) -> Result<bool> {
        let n = self.conn.execute(
            "UPDATE sessions SET title = ?1, updated = ?2 WHERE id = ?3",
            params![title, now as i64, id],
        )?;
        Ok(n > 0)
    }

    pub fn append_event(&self, session: &str, kind: &str, text: &str, time: u64) -> Result<Event> {
        let key = next_id(&self.conn, "events", "key", "ev_")?;
        self.conn.execute(
            "INSERT INTO events (key, session, kind, text, time) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![key, session, kind, text, time as i64],
        )?;
        Ok(Event { key, kind: kind.to_string(), text: text.to_string(), time })
    }

    pub fn read_events(&self, session: &str, limit: usize) -> Result<Vec<Event>> {
        let sql = if limit == 0 {
            "SELECT key, kind, text, time FROM events WHERE session = ?1 ORDER BY key".to_string()
        } else {
            format!(
                "SELECT key, kind, text, time FROM events WHERE session = ?1 ORDER BY key DESC LIMIT {}",
                limit
            )
        };
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params![session], |row| {
            Ok(Event {
                key: row.get(0)?,
                kind: row.get(1)?,
                text: row.get(2)?,
                time: row.get::<_, i64>(3)? as u64,
            })
        })?;
        let mut out: Vec<Event> = rows.collect::<Result<Vec<_>>>()?;
        if limit > 0 {
            out.reverse();
        }
        Ok(out)
    }

    pub fn perm_request(&self, session: &str, action: &str, resource: &str) -> Result<PermissionRequest> {
        let id = next_id(&self.conn, "permissions", "id", "per_")?;
        self.conn.execute(
            "INSERT INTO permissions (id, session, action, resource) VALUES (?1, ?2, ?3, ?4)",
            params![id, session, action, resource],
        )?;
        Ok(PermissionRequest {
            id,
            session: session.to_string(),
            action: action.to_string(),
            resource: resource.to_string(),
        })
    }

    pub fn perm_list(&self, session: &str) -> Result<Vec<PermissionRequest>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session, action, resource FROM permissions WHERE session = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![session], |row| {
            Ok(PermissionRequest {
                id: row.get(0)?,
                session: row.get(1)?,
                action: row.get(2)?,
                resource: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn perm_reply(&self, session: &str, id: &str, decision: Decision) -> Result<bool> {
        let n = self.conn.execute(
            "DELETE FROM permissions WHERE session = ?1 AND id = ?2",
            params![session, id],
        )?;
        if n == 0 {
            return Ok(false);
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO resolved_perms (id, decision) VALUES (?1, ?2)",
            params![id, decision.as_str()],
        )?;
        Ok(true)
    }

    pub fn perm_consume(&self, id: &str) -> Result<Option<Decision>> {
        let decision: Option<String> = self
            .conn
            .query_row("SELECT decision FROM resolved_perms WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .ok();
        match decision.as_deref() {
            Some("once") | Some("allow") => {
                self.conn.execute("DELETE FROM resolved_perms WHERE id = ?1", params![id])?;
                Ok(Some(Decision::AllowOnce))
            }
            Some("deny") | Some("reject") => {
                self.conn.execute("DELETE FROM resolved_perms WHERE id = ?1", params![id])?;
                Ok(Some(Decision::Deny))
            }
            _ => Ok(None),
        }
    }

    pub fn question_ask(&self, session: &str, items: Vec<QuestionItem>) -> Result<QuestionRequest> {
        let id = next_id(&self.conn, "questions", "id", "que_")?;
        let tmp = QuestionRequest { id: id.clone(), session: session.to_string(), items };
        let line = encode_question(&tmp);
        let body = line.splitn(3, '\t').nth(2).unwrap_or("").to_string();
        self.conn.execute(
            "INSERT INTO questions (id, session, body) VALUES (?1, ?2, ?3)",
            params![id, session, body],
        )?;
        Ok(tmp)
    }

    pub fn question_list(&self, session: &str) -> Result<Vec<QuestionRequest>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session, body FROM questions WHERE session = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![session], |row| {
            let id: String = row.get(0)?;
            let session: String = row.get(1)?;
            let body: String = row.get(2)?;
            Ok((id, session, body))
        })?;
        let mut out = Vec::new();
        for r in rows {
            let (id, session, body) = r?;
            let line = format!("{}\t{}\t{}", id, session, body);
            if let Some(req) = decode_question(&line) {
                out.push(req);
            }
        }
        Ok(out)
    }

    pub fn question_reply(&self, session: &str, id: &str, answers: &[Vec<String>]) -> Result<bool> {
        let current = self.question_list(session)?;
        let req = match current.iter().find(|r| r.id == id) {
            Some(v) => v,
            None => return Ok(false),
        };
        if answers.len() != req.items.len() {
            return Ok(false);
        }
        for (a, item) in answers.iter().zip(req.items.iter()) {
            if !item.multiple && a.len() != 1 {
                return Ok(false);
            }
            for label in a {
                if !item.options.iter().any(|o| &o.label == label) {
                    return Ok(false);
                }
            }
        }
        let n = self.conn.execute(
            "DELETE FROM questions WHERE session = ?1 AND id = ?2",
            params![session, id],
        )?;
        Ok(n > 0)
    }

    pub fn todo_put(&self, session: &str, contents: Vec<(String, String, String)>) -> Result<usize> {
        let tx = &self.conn;
        tx.execute("DELETE FROM todos WHERE session = ?1", params![session])?;
        let n = contents.len();
        for (i, (content, status, priority)) in contents.into_iter().enumerate() {
            tx.execute(
                "INSERT INTO todos (session, position, content, status, priority) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![session, i as i64, content, status, priority],
            )?;
        }
        Ok(n)
    }

    pub fn todo_list(&self, session: &str) -> Result<Vec<TodoItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT position, content, status, priority FROM todos WHERE session = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map(params![session], |row| {
            Ok(TodoItem {
                position: row.get::<_, i64>(0)? as u32,
                content: row.get(1)?,
                status: row.get(2)?,
                priority: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn todo_done(&self, session: &str, position: u32) -> Result<bool> {
        let n = self.conn.execute(
            "UPDATE todos SET status = 'done' WHERE session = ?1 AND position = ?2",
            params![session, position as i64],
        )?;
        Ok(n > 0)
    }

    pub fn auth_set(&self, user: &str, provider: &str, key: &str, now: u64) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO auth (user, provider, key, created) VALUES (?1, ?2, ?3, ?4)",
            params![user, provider, key, now as i64],
        )?;
        Ok(())
    }

    pub fn auth_has(&self, user: &str, provider: &str) -> Result<bool> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM auth WHERE user = ?1 AND provider = ?2",
            params![user, provider],
            |row| row.get(0),
        )?;
        Ok(n > 0)
    }

    pub fn auth_del(&self, user: &str, provider: &str) -> Result<bool> {
        let n = self.conn.execute(
            "DELETE FROM auth WHERE user = ?1 AND provider = ?2",
            params![user, provider],
        )?;
        Ok(n > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_crud() {
        let db = DbStore::open_memory().unwrap();
        let s = db.create_session("/repo", "mimo-v2.5-free", 100).unwrap();
        assert_eq!(s.id, "ses_0001");
        assert!(db.session_exists("ses_0001"));
        assert!(!db.session_exists("ses_9999"));
        assert_eq!(db.list_sessions().unwrap().len(), 1);
        assert!(db.rename_session("ses_0001", "demo", 120).unwrap());
        assert!(!db.rename_session("ses_9999", "x", 130).unwrap());
    }

    #[test]
    fn events_limit_order() {
        let db = DbStore::open_memory().unwrap();
        db.create_session("/r", "m", 1).unwrap();
        db.append_event("ses_0001", "text", "a", 1).unwrap();
        db.append_event("ses_0001", "text", "b", 2).unwrap();
        assert_eq!(db.read_events("ses_0001", 0).unwrap().len(), 2);
        let last = db.read_events("ses_0001", 1).unwrap();
        assert_eq!(last.len(), 1);
        assert_eq!(last[0].text, "b");
    }

    #[test]
    fn permissions_once() {
        let db = DbStore::open_memory().unwrap();
        db.create_session("/r", "m", 1).unwrap();
        let r = db.perm_request("ses_0001", "bash", "x").unwrap();
        assert_eq!(r.id, "per_0001");
        assert_eq!(db.perm_list("ses_0001").unwrap().len(), 1);
        assert!(db.perm_reply("ses_0001", "per_0001", Decision::AllowOnce).unwrap());
        assert!(!db.perm_reply("ses_0001", "per_0001", Decision::Deny).unwrap());
        assert_eq!(db.perm_consume("per_0001").unwrap(), Some(Decision::AllowOnce));
        assert_eq!(db.perm_consume("per_0001").unwrap(), None);
    }

    #[test]
    fn questions_validate() {
        use crate::questions::{QuestionItem, QuestionOption};
        let db = DbStore::open_memory().unwrap();
        db.create_session("/r", "m", 1).unwrap();
        let items = vec![QuestionItem {
            question: "Which one?".to_string(),
            options: vec![
                QuestionOption { label: "Alpha".to_string() },
                QuestionOption { label: "Beta".to_string() },
            ],
            multiple: false,
        }];
        let r = db.question_ask("ses_0001", items).unwrap();
        assert_eq!(r.id, "que_0001");
        assert!(!db.question_reply("ses_0001", "que_0001", &[vec!["Gamma".to_string()]]).unwrap());
        assert!(db.question_reply("ses_0001", "que_0001", &[vec!["Alpha".to_string()]]).unwrap());
        assert!(!db.question_reply("ses_0001", "que_0001", &[vec!["Alpha".to_string()]]).unwrap());
    }

    #[test]
    fn todos_flow() {        let db = DbStore::open_memory().unwrap();
        db.create_session("/r", "m", 1).unwrap();
        let n = db.todo_put("ses_0001", vec![
            ("a".to_string(), "pending".to_string(), "medium".to_string()),
            ("b".to_string(), "pending".to_string(), "medium".to_string()),
        ]).unwrap();
        assert_eq!(n, 2);
        assert!(db.todo_done("ses_0001", 0).unwrap());
        assert_eq!(db.todo_list("ses_0001").unwrap()[0].status, "done");
        assert!(!db.todo_done("ses_0001", 9).unwrap());
    }

    #[test]
    fn auth_set_has_del() {
        let db = DbStore::open_memory().unwrap();
        assert!(!db.auth_has("u1", "zen").unwrap());
        db.auth_set("u1", "zen", "secret", 10).unwrap();
        assert!(db.auth_has("u1", "zen").unwrap());
        assert!(!db.auth_has("u1", "openrouter").unwrap());
        assert!(!db.auth_has("u2", "zen").unwrap());
        assert!(db.auth_del("u1", "zen").unwrap());
        assert!(!db.auth_has("u1", "zen").unwrap());
        assert!(!db.auth_del("u1", "zen").unwrap());
    }
}
