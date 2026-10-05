use durev_core::analyze_diff;
use durev_core::db::DbStore;
use durev_core::events::{encode_line as encode_event, EventLog};
use durev_core::models::FREE_MODELS;
use durev_core::permissions::{encode_line as encode_perm, Decision, PermissionStore};
use durev_core::questions::{encode_line as encode_question, QuestionItem, QuestionOption, QuestionStore};
use durev_core::sessions::{encode_line as encode_session, SessionStore};
use durev_core::todos::{encode_parts as encode_todo, TodoItem, TodoStore};
use durev_core::tools::{apply_patch, tool_bash, tool_read, tool_write, PatchOp};
use durev_core::version;
use std::io::Read;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_stdin_all() -> String {
    let mut text = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut text).is_err() {
        eprintln!("stdin failed");
        std::process::exit(2);
    }
    text.trim_end_matches(|c| c == '\n' || c == '\r').to_string()
}

fn print_stat(add: u32, del: u32, hunks: u32, score: u32) {
    println!("add={} del={} hunks={} score={} version={}", add, del, hunks, score, version());
}

struct Stores {
    sessions: SessionStore,
    events: EventLog,
    perms: PermissionStore,
    questions: QuestionStore,
    todos: TodoStore,
}

fn load_store(path: &str) -> Stores {
    let mut sessions = SessionStore::new();
    let mut events = EventLog::new();
    let mut perms = PermissionStore::new();
    let mut questions = QuestionStore::new();
    let mut todos = TodoStore::new();
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut session_lines = String::new();
    let mut event_lines = String::new();
    let mut perm_lines = String::new();
    let mut question_lines = String::new();
    let mut todo_lines = String::new();
    for line in text.lines() {
        if line.starts_with("S\t") {
            session_lines.push_str(&line[2..]);
            session_lines.push('\n');
        } else if line.starts_with("E\t") {
            event_lines.push_str(&line[2..]);
            event_lines.push('\n');
        } else if line.starts_with("P\t") {
            perm_lines.push_str(&line[2..]);
            perm_lines.push('\n');
        } else if line.starts_with("Q\t") {
            question_lines.push_str(&line[2..]);
            question_lines.push('\n');
        } else if line.starts_with("T\t") {
            todo_lines.push_str(&line[2..]);
            todo_lines.push('\n');
        }
    }
    sessions.load_text(&session_lines);
    events.load_text(&event_lines);
    perms.load_text(&perm_lines);
    questions.load_text(&question_lines);
    todos.load_text(&todo_lines);
    Stores { sessions, events, perms, questions, todos }
}

fn save_store(path: &str, st: &Stores) {
    let mut out = String::new();
    for s in st.sessions.list() {
        out.push_str("S\t");
        out.push_str(&encode_session(s));
        out.push('\n');
    }
    for s in st.sessions.list() {
        for e in st.events.read(&s.id, 0) {
            out.push_str("E\t");
            out.push_str(&encode_event(&s.id, &e));
            out.push('\n');
        }
        for r in st.perms.list(&s.id) {
            out.push_str("P\t");
            out.push_str(&encode_perm(&r));
            out.push('\n');
        }
        for r in st.questions.list(&s.id) {
            out.push_str("Q\t");
            out.push_str(&encode_question(&r));
            out.push('\n');
        }
        for t in st.todos.list(&s.id) {
            out.push_str("T\t");
            out.push_str(&encode_todo(&s.id, &t));
            out.push('\n');
        }
    }
    if let Some(parent) = std::path::Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            let _ = std::fs::create_dir_all(parent);
        }
    }
    if let Err(e) = std::fs::write(path, out) {
        eprintln!("write failed: {}", e);
        std::process::exit(2);
    }
}

fn is_db(path: &str) -> bool {
    path.ends_with(".db") || path.ends_with(".sqlite") || path.ends_with(".sqlite3")
}

fn open_db(path: &str) -> DbStore {
    match DbStore::open(path) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("db open failed: {}", e);
            std::process::exit(2);
        }
    }
}

fn need_session(st: &Stores, session: &str) {
    if st.sessions.get(session).is_none() {
        eprintln!("unknown session");
        std::process::exit(3);
    }
}

fn need_db_session(db: &DbStore, session: &str) {
    if !db.session_exists(session) {
        eprintln!("unknown session");
        std::process::exit(3);
    }
}

fn parse_patch_file(text: &str) -> Result<Vec<PatchOp>, String> {
    let mut ops: Vec<PatchOp> = Vec::new();
    let mut blocks: Vec<Vec<String>> = vec![Vec::new()];
    for line in text.lines() {
        if line == "===" {
            blocks.push(Vec::new());
        } else {
            blocks.last_mut().unwrap().push(line.to_string());
        }
    }
    for block in blocks {
        if block.iter().all(|l| l.trim().is_empty()) {
            continue;
        }
        let head = block.first().map(|s| s.as_str()).unwrap_or("");
        if let Some(path) = head.strip_prefix("ADD ") {
            let content = block[1..].join("\n");
            let content = if content.is_empty() { content } else { content + "\n" };
            ops.push(PatchOp::Add { path: path.to_string(), content });
        } else if let Some(path) = head.strip_prefix("DELETE ") {
            ops.push(PatchOp::Delete { path: path.to_string() });
        } else if let Some(path) = head.strip_prefix("UPDATE ") {
            let rest = &block[1..];
            let sep = rest.iter().position(|l| l == "---");
            match sep {
                Some(i) => {
                    let old = rest[..i].join("\n") + "\n";
                    let new = rest[i + 1..].join("\n") + "\n";
                    ops.push(PatchOp::Update { path: path.to_string(), old, new, all: false });
                }
                None => return Err(format!("UPDATE without ---: {}", path)),
            }
        } else {
            return Err(format!("bad block: {}", head));
        }
    }
    Ok(ops)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && (args[1] == "--version" || args[1] == "-V") {
        println!("{}", version());
        return;
    }
    if args.len() > 1 && args[1] == "models" {
        for m in FREE_MODELS {
            let ep = match m.endpoint {
                durev_core::models::Endpoint::ChatCompletions => "chat",
                durev_core::models::Endpoint::Responses => "responses",
            };
            let pv = match m.provider {
                durev_core::models::Provider::Zen => "zen",
                durev_core::models::Provider::OpenRouter => "openrouter",
            };
            println!("{} provider={} endpoint={}", m.id, pv, ep);
        }
        return;
    }
    if args.len() > 1 && args[1] == "session-create" {
        if args.len() < 4 {
            eprintln!("usage: durev session-create <store> <dir> [model]");
            std::process::exit(2);
        }
        let model = if args.len() > 4 { args[4].clone() } else { "mimo-v2.5-free".to_string() };
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            let s = db.create_session(&args[3], &model, now_secs()).unwrap_or_else(|e| {
                eprintln!("db failed: {}", e);
                std::process::exit(2);
            });
            println!("{}", s.id);
            return;
        }
        let mut st = load_store(&args[2]);
        let s = st.sessions.create(&args[3], &model, now_secs());
        save_store(&args[2], &st);
        println!("{}", s.id);
        return;
    }
    if args.len() > 1 && args[1] == "session-list" {
        if args.len() < 3 {
            eprintln!("usage: durev session-list <store>");
            std::process::exit(2);
        }
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.list_sessions() {
                Ok(list) => {
                    for s in list {
                        println!("{} dir={} model={} title={}", s.id, s.directory, s.model, s.title);
                    }
                }
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let st = load_store(&args[2]);
        for s in st.sessions.list() {
            println!("{} dir={} model={} title={}", s.id, s.directory, s.model, s.title);
        }
        return;
    }
    if args.len() > 1 && args[1] == "event-append" {
        if args.len() < 6 {
            eprintln!("usage: durev event-append <store> <session> <kind> <text>");
            std::process::exit(2);
        }
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            need_db_session(&db, &args[3]);
            match db.append_event(&args[3], &args[4], &args[5], now_secs()) {
                Ok(e) => println!("{}", e.key),
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let mut st = load_store(&args[2]);
        need_session(&st, &args[3]);
        let e = st.events.append(&args[3], &args[4], &args[5], now_secs());
        save_store(&args[2], &st);
        println!("{}", e.key);
        return;
    }
    if args.len() > 1 && args[1] == "event-read" {
        if args.len() < 4 {
            eprintln!("usage: durev event-read <store> <session> [limit]");
            std::process::exit(2);
        }
        let limit = if args.len() > 4 { args[4].parse().unwrap_or(0) } else { 0 };
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.read_events(&args[3], limit) {
                Ok(list) => {
                    for e in list {
                        println!("{} {} {}", e.key, e.kind, e.text);
                    }
                }
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let st = load_store(&args[2]);
        for e in st.events.read(&args[3], limit) {
            println!("{} {} {}", e.key, e.kind, e.text);
        }
        return;
    }
    if args.len() > 1 && args[1] == "perm-request" {
        if args.len() < 6 {
            eprintln!("usage: durev perm-request <store> <session> <action> <resource>");
            std::process::exit(2);
        }
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            need_db_session(&db, &args[3]);
            match db.perm_request(&args[3], &args[4], &args[5]) {
                Ok(r) => println!("{}", r.id),
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let mut st = load_store(&args[2]);
        need_session(&st, &args[3]);
        let r = st.perms.request(&args[3], &args[4], &args[5]);
        save_store(&args[2], &st);
        println!("{}", r.id);
        return;
    }
    if args.len() > 1 && args[1] == "perm-list" {
        if args.len() < 4 {
            eprintln!("usage: durev perm-list <store> <session>");
            std::process::exit(2);
        }
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.perm_list(&args[3]) {
                Ok(list) => {
                    for r in list {
                        println!("{} {} {}", r.id, r.action, r.resource);
                    }
                }
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let st = load_store(&args[2]);
        for r in st.perms.list(&args[3]) {
            println!("{} {} {}", r.id, r.action, r.resource);
        }
        return;
    }
    if args.len() > 1 && args[1] == "perm-reply" {
        if args.len() < 6 {
            eprintln!("usage: durev perm-reply <store> <session> <id> <once|deny>");
            std::process::exit(2);
        }
        let d = match Decision::from_str(&args[5]) {
            Some(v) => v,
            None => {
                eprintln!("bad decision");
                std::process::exit(2);
            }
        };
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.perm_reply(&args[3], &args[4], d) {
                Ok(ok) => println!("{}", ok),
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let mut st = load_store(&args[2]);
        let ok = st.perms.reply(&args[3], &args[4], d);
        save_store(&args[2], &st);
        println!("{}", ok);
        return;
    }
    if args.len() > 1 && args[1] == "question-ask" {
        if args.len() < 6 {
            eprintln!("usage: durev question-ask <store> <session> <question> <opt1,opt2> [multiple]");
            std::process::exit(2);
        }
        let multiple = args.len() > 6 && args[6] == "1";
        let options: Vec<QuestionOption> = args[5]
            .split(',')
            .filter(|s| !s.is_empty())
            .map(|s| QuestionOption { label: s.to_string() })
            .collect();
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            need_db_session(&db, &args[3]);
            match db.question_ask(&args[3], vec![QuestionItem { question: args[4].clone(), options, multiple }]) {
                Ok(r) => println!("{}", r.id),
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let mut st = load_store(&args[2]);
        need_session(&st, &args[3]);
        let r = st.questions.ask(&args[3], vec![QuestionItem { question: args[4].clone(), options, multiple }]);
        save_store(&args[2], &st);
        println!("{}", r.id);
        return;
    }
    if args.len() > 1 && args[1] == "question-list" {
        if args.len() < 4 {
            eprintln!("usage: durev question-list <store> <session>");
            std::process::exit(2);
        }
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.question_list(&args[3]) {
                Ok(list) => {
                    for r in list {
                        let first = r.items.first();
                        let q = first.map(|i| i.question.clone()).unwrap_or_default();
                        let opts: Vec<String> = first.map(|i| i.options.iter().map(|o| o.label.clone()).collect()).unwrap_or_default();
                        println!("{} {} [{}]", r.id, q, opts.join(","));
                    }
                }
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let st = load_store(&args[2]);
        for r in st.questions.list(&args[3]) {
            let first = r.items.first();
            let q = first.map(|i| i.question.clone()).unwrap_or_default();
            let opts: Vec<String> = first.map(|i| i.options.iter().map(|o| o.label.clone()).collect()).unwrap_or_default();
            println!("{} {} [{}]", r.id, q, opts.join(","));
        }
        return;
    }
    if args.len() > 1 && args[1] == "question-reply" {
        if args.len() < 6 {
            eprintln!("usage: durev question-reply <store> <session> <id> <label1,label2>");
            std::process::exit(2);
        }
        let mut st = load_store(&args[2]);
        let labels: Vec<String> = args[5].split(',').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect();
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.question_reply(&args[3], &args[4], &[labels]) {
                Ok(ok) => println!("{}", ok),
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let ok = st.questions.reply(&args[3], &args[4], &[labels]);
        save_store(&args[2], &st);
        println!("{}", ok);
        return;
    }
    if args.len() > 1 && args[1] == "todo-put" {
        if args.len() < 5 {
            eprintln!("usage: durev todo-put <store> <session> <content...>");
            std::process::exit(2);
        }
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            need_db_session(&db, &args[3]);
            let items: Vec<(String, String, String)> = args[4..]
                .iter()
                .map(|c| (c.clone(), "pending".to_string(), "medium".to_string()))
                .collect();
            match db.todo_put(&args[3], items) {
                Ok(n) => println!("{}", n),
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let mut st = load_store(&args[2]);
        need_session(&st, &args[3]);
        let items: Vec<TodoItem> = args[4..]
            .iter()
            .map(|c| TodoItem { content: c.clone(), status: "pending".to_string(), priority: "medium".to_string(), position: 0 })
            .collect();
        let n = items.len();
        st.todos.put(&args[3], items);
        save_store(&args[2], &st);
        println!("{}", n);
        return;
    }
    if args.len() > 1 && args[1] == "todo-list" {
        if args.len() < 4 {
            eprintln!("usage: durev todo-list <store> <session>");
            std::process::exit(2);
        }
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.todo_list(&args[3]) {
                Ok(list) => {
                    for t in list {
                        println!("{} [{}] {}", t.position, t.status, t.content);
                    }
                }
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let st = load_store(&args[2]);
        for t in st.todos.list(&args[3]) {
            println!("{} [{}] {}", t.position, t.status, t.content);
        }
        return;
    }
    if args.len() > 1 && args[1] == "todo-done" {
        if args.len() < 5 {
            eprintln!("usage: durev todo-done <store> <session> <position>");
            std::process::exit(2);
        }
        let pos: u32 = match args[4].parse() {
            Ok(v) => v,
            Err(_) => {
                eprintln!("bad position");
                std::process::exit(2);
            }
        };
        if is_db(&args[2]) {
            let db = open_db(&args[2]);
            match db.todo_done(&args[3], pos) {
                Ok(ok) => println!("{}", ok),
                Err(e) => {
                    eprintln!("db failed: {}", e);
                    std::process::exit(2);
                }
            }
            return;
        }
        let mut st = load_store(&args[2]);
        let ok = st.todos.set_status(&args[3], pos, "done");
        save_store(&args[2], &st);
        println!("{}", ok);
        return;
    }
    if args.len() > 1 && args[1] == "auth-set" {
        if args.len() < 6 {
            eprintln!("usage: durev auth-set <store.db> <user> <provider> <key|->");
            std::process::exit(2);
        }
        let key = if args[5] == "-" { read_stdin_all() } else { args[5].clone() };
        if key.is_empty() {
            eprintln!("empty key");
            std::process::exit(2);
        }
        let db = open_db(&args[2]);
        match db.auth_set(&args[3], &args[4], &key, now_secs()) {
            Ok(()) => println!("ok"),
            Err(_) => {
                eprintln!("db failed");
                std::process::exit(2);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "auth-has" {
        if args.len() < 5 {
            eprintln!("usage: durev auth-has <store.db> <user> <provider>");
            std::process::exit(2);
        }
        let db = open_db(&args[2]);
        match db.auth_has(&args[3], &args[4]) {
            Ok(v) => println!("{}", if v { "yes" } else { "no" }),
            Err(_) => {
                eprintln!("db failed");
                std::process::exit(2);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "auth-del" {
        if args.len() < 5 {
            eprintln!("usage: durev auth-del <store.db> <user> <provider>");
            std::process::exit(2);
        }
        let db = open_db(&args[2]);
        match db.auth_del(&args[3], &args[4]) {
            Ok(v) => println!("{}", v),
            Err(_) => {
                eprintln!("db failed");
                std::process::exit(2);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "check-rules" {
        if args.len() < 5 {
            eprintln!("usage: durev check-rules <root> <tool> <input>");
            std::process::exit(2);
        }
        let home = std::env::var("HOME").unwrap_or_default();
        let chain = durev_core::rules::full_chain(&args[2], &[]);
        let v = durev_core::rules::evaluate(&chain, &args[3], &args[4], &home);
        println!("{}", v.as_str());
        return;
    }
    if args.len() > 1 && args[1] == "always-add" {
        if args.len() < 5 {
            eprintln!("usage: durev always-add <store.db> <tool> <pattern>");
            std::process::exit(2);
        }
        let db = open_db(&args[2]);
        match db.always_add(&args[3], &args[4]) {
            Ok(()) => println!("ok"),
            Err(_) => {
                eprintln!("db failed");
                std::process::exit(2);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "always-list" {
        if args.len() < 3 {
            eprintln!("usage: durev always-list <store.db>");
            std::process::exit(2);
        }
        let db = open_db(&args[2]);
        match db.always_list() {
            Ok(list) => {
                for (tool, pattern) in list {
                    println!("{} {}", tool, pattern);
                }
            }
            Err(_) => {
                eprintln!("db failed");
                std::process::exit(2);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "always-del" {
        if args.len() < 5 {
            eprintln!("usage: durev always-del <store.db> <tool> <pattern>");
            std::process::exit(2);
        }
        let db = open_db(&args[2]);
        match db.always_del(&args[3], &args[4]) {
            Ok(v) => println!("{}", v),
            Err(_) => {
                eprintln!("db failed");
                std::process::exit(2);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "tool-read" {
        if args.len() < 4 {
            eprintln!("usage: durev tool-read <root> <path> [limit]");
            std::process::exit(2);
        }
        let limit = if args.len() > 4 { args[4].parse().unwrap_or(0) } else { 0 };
        match tool_read(&args[2], &args[3], limit) {
            Ok(text) => print!("{}", text),
            Err(e) => {
                eprintln!("tool failed: {}", e);
                std::process::exit(3);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "tool-write" {
        if args.len() < 5 {
            eprintln!("usage: durev tool-write <root> <path> <content>");
            std::process::exit(2);
        }
        let content = args[4..].join(" ");
        match tool_write(&args[2], &args[3], &content) {
            Ok(n) => println!("{}", n),
            Err(e) => {
                eprintln!("tool failed: {}", e);
                std::process::exit(3);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "tool-bash" {
        if args.len() < 5 {
            eprintln!("usage: durev tool-bash <root> <timeout_ms> <cmd> [args...]");
            std::process::exit(2);
        }
        let timeout: u64 = args[3].parse().unwrap_or(120000);
        let cmd_args: Vec<String> = args[5..].to_vec();
        match tool_bash(&args[2], &args[4], &cmd_args, timeout) {
            Ok(r) => {
                println!("status={} timed_out={}", r.status, r.timed_out);
                print!("{}", r.stdout);
                eprint!("{}", r.stderr);
            }
            Err(e) => {
                eprintln!("tool failed: {}", e);
                std::process::exit(3);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "tool-patch" {
        if args.len() < 4 {
            eprintln!("usage: durev tool-patch <root> <patchfile>");
            std::process::exit(2);
        }
        let text = match std::fs::read_to_string(&args[3]) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("read failed: {}", e);
                std::process::exit(2);
            }
        };
        let ops = match parse_patch_file(&text) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("bad patch: {}", e);
                std::process::exit(2);
            }
        };
        match apply_patch(&args[2], &ops) {
            Ok(r) => println!("added={} updated={} deleted={}", r.added, r.updated, r.deleted),
            Err(e) => {
                eprintln!("tool failed: {}", e);
                std::process::exit(3);
            }
        }
        return;
    }
    if args.len() > 1 && args[1] == "tool-run" {
        if args.len() < 7 {
            eprintln!("usage: durev tool-run <store.db> <root> <session> <permid> <tool> [args...]");
            std::process::exit(2);
        }
        if !is_db(&args[2]) {
            eprintln!("tool-run needs a .db store");
            std::process::exit(2);
        }
        let db = open_db(&args[2]);
        let decision = match db.perm_consume(&args[5]) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("db failed: {}", e);
                std::process::exit(2);
            }
        };
        match decision {
            Some(durev_core::permissions::Decision::AllowOnce) => {}
            _ => {
                eprintln!("denied");
                std::process::exit(4);
            }
        }
        let tool = args[6].clone();
        let rest: Vec<String> = args[7..].to_vec();
        if tool == "read" {
            if rest.is_empty() {
                eprintln!("usage: tool-run <db> <root> <session> <permid> read <path> [limit]");
                std::process::exit(2);
            }
            let limit = if rest.len() > 1 { rest[1].parse().unwrap_or(0) } else { 0 };
            match tool_read(&args[3], &rest[0], limit) {
                Ok(text) => print!("{}", text),
                Err(e) => {
                    eprintln!("tool failed: {}", e);
                    std::process::exit(3);
                }
            }
        } else if tool == "write" {
            if rest.len() < 2 {
                eprintln!("usage: tool-run <db> <root> <session> <permid> write <path> <content>");
                std::process::exit(2);
            }
            match tool_write(&args[3], &rest[0], &rest[1..].join(" ")) {
                Ok(n) => println!("{}", n),
                Err(e) => {
                    eprintln!("tool failed: {}", e);
                    std::process::exit(3);
                }
            }
        } else if tool == "bash" {
            if rest.is_empty() {
                eprintln!("usage: tool-run <db> <root> <session> <permid> bash <cmd> [args...]");
                std::process::exit(2);
            }
            let cmd_args: Vec<String> = rest[1..].to_vec();
            match tool_bash(&args[3], &rest[0], &cmd_args, 120000) {
                Ok(r) => {
                    println!("status={} timed_out={}", r.status, r.timed_out);
                    print!("{}", r.stdout);
                }
                Err(e) => {
                    eprintln!("tool failed: {}", e);
                    std::process::exit(3);
                }
            }
        } else {
            eprintln!("unknown tool");
            std::process::exit(2);
        }
        return;
    }
    if args.len() > 1 && !args[1].starts_with('-') {
        match std::fs::read_to_string(&args[1]) {
            Ok(v) => {
                let s = analyze_diff(&v);
                print_stat(s.add, s.del, s.hunks, s.score);
                return;
            }
            Err(e) => {
                eprintln!("read failed: {}", e);
                std::process::exit(2);
            }
        }
    }
    let mut text = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut text) {
        eprintln!("stdin failed: {}", e);
        std::process::exit(2);
    }
    let s = analyze_diff(&text);
    print_stat(s.add, s.del, s.hunks, s.score);
}
