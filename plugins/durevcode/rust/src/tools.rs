use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

pub const MAX_READ_BYTES: u64 = 262144;
pub const MAX_BASH_BYTES: usize = 1048576;

#[derive(Debug, PartialEq, Eq)]
pub enum ToolError {
    OutsideRoot,
    NotFound(String),
    Io(String),
    Timeout,
    Mismatch(String),
    Denied,
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ToolError::OutsideRoot => write!(f, "path escapes workspace root"),
            ToolError::NotFound(p) => write!(f, "not found: {}", p),
            ToolError::Io(e) => write!(f, "io: {}", e),
            ToolError::Timeout => write!(f, "command timed out"),
            ToolError::Mismatch(m) => write!(f, "patch mismatch: {}", m),
            ToolError::Denied => write!(f, "permission denied or consumed"),
        }
    }
}

pub fn resolve_within(root: &str, rel: &str) -> Result<PathBuf, ToolError> {
    use std::path::Component;
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(ToolError::OutsideRoot);
    }
    let root_path = Path::new(root);
    let base = if root_path.is_absolute() {
        root_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| ToolError::Io(e.to_string()))?
            .join(root_path)
    };
    let base = base.canonicalize().map_err(|_| ToolError::NotFound(root.to_string()))?;
    let mut stack: Vec<std::ffi::OsString> = base
        .components()
        .map(|c| c.as_os_str().to_os_string())
        .collect();
    let depth = stack.len();
    for comp in rel_path.components() {
        match comp {
            Component::Prefix(_) | Component::RootDir => return Err(ToolError::OutsideRoot),
            Component::CurDir => {}
            Component::ParentDir => {
                if stack.len() <= depth {
                    return Err(ToolError::OutsideRoot);
                }
                stack.pop();
            }
            Component::Normal(name) => stack.push(name.to_os_string()),
        }
    }
    let mut full = PathBuf::new();
    for part in stack {
        full.push(part);
    }
    if full.starts_with(&base) {
        Ok(full)
    } else {
        Err(ToolError::OutsideRoot)
    }
}

pub fn tool_read(root: &str, rel: &str, limit_lines: usize) -> Result<String, ToolError> {
    let path = resolve_within(root, rel)?;
    let meta = std::fs::metadata(&path).map_err(|_| ToolError::NotFound(rel.to_string()))?;
    if !meta.is_file() {
        return Err(ToolError::NotFound(rel.to_string()));
    }
    let mut file = std::fs::File::open(&path).map_err(|e| ToolError::Io(e.to_string()))?;
    let mut buf = Vec::new();
    file.by_ref()
        .take(MAX_READ_BYTES)
        .read_to_end(&mut buf)
        .map_err(|e| ToolError::Io(e.to_string()))?;
    let text = String::from_utf8_lossy(&buf).to_string();
    if limit_lines == 0 {
        return Ok(text);
    }
    let lines: Vec<&str> = text.lines().take(limit_lines).collect();
    Ok(lines.join("\n"))
}

pub fn tool_write(root: &str, rel: &str, content: &str) -> Result<u64, ToolError> {
    let path = resolve_within(root, rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ToolError::Io(e.to_string()))?;
    }
    std::fs::write(&path, content).map_err(|e| ToolError::Io(e.to_string()))?;
    Ok(content.len() as u64)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BashResult {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

pub fn tool_bash(root: &str, cmd: &str, args: &[String], timeout_ms: u64) -> Result<BashResult, ToolError> {
    let base = Path::new(root);
    if !base.exists() {
        return Err(ToolError::NotFound(root.to_string()));
    }
    let mut child = std::process::Command::new(cmd)
        .args(args)
        .current_dir(base)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| ToolError::Io(e.to_string()))?;
    let mut out_handle = child.stdout.take();
    let mut err_handle = child.stderr.take();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut out = Vec::new();
        let mut err = Vec::new();
        if let Some(h) = out_handle.as_mut() {
            let _ = h.take(MAX_BASH_BYTES as u64).read_to_end(&mut out);
        }
        if let Some(h) = err_handle.as_mut() {
            let _ = h.take(MAX_BASH_BYTES as u64).read_to_end(&mut err);
        }
        let _ = tx.send((out, err));
    });
    let deadline = Duration::from_millis(if timeout_ms == 0 { 120000 } else { timeout_ms });
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| ToolError::Io(e.to_string()))? {
            Some(status) => {
                let code = status.code().unwrap_or(-1);
                let (out, err) = rx.recv().unwrap_or_default();
                return Ok(BashResult {
                    status: code,
                    stdout: truncate_lossy(out),
                    stderr: truncate_lossy(err),
                    timed_out: false,
                });
            }
            None => {
                if start.elapsed() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let (out, err) = rx.recv_timeout(Duration::from_secs(2)).unwrap_or_default();
                    return Ok(BashResult {
                        status: -1,
                        stdout: truncate_lossy(out),
                        stderr: truncate_lossy(err),
                        timed_out: true,
                    });
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }
}

fn truncate_lossy(bytes: Vec<u8>) -> String {
    let mut v = bytes;
    if v.len() > MAX_BASH_BYTES {
        v.truncate(MAX_BASH_BYTES);
    }
    String::from_utf8_lossy(&v).to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchOp {
    Add { path: String, content: String },
    Update { path: String, old: String, new: String, all: bool },
    Delete { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyReport {
    pub added: u32,
    pub updated: u32,
    pub deleted: u32,
}

pub fn apply_patch(root: &str, ops: &[PatchOp]) -> Result<ApplyReport, ToolError> {
    let mut report = ApplyReport { added: 0, updated: 0, deleted: 0 };
    for op in ops {
        match op {
            PatchOp::Add { path, content } => {
                let full = resolve_within(root, path)?;
                if full.exists() {
                    return Err(ToolError::Mismatch(format!("exists: {}", path)));
                }
                if let Some(parent) = full.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| ToolError::Io(e.to_string()))?;
                }
                std::fs::write(&full, content).map_err(|e| ToolError::Io(e.to_string()))?;
                report.added += 1;
            }
            PatchOp::Update { path, old, new, all } => {
                let full = resolve_within(root, path)?;
                let current =
                    std::fs::read_to_string(&full).map_err(|_| ToolError::NotFound(path.clone()))?;
                if !current.contains(old.as_str()) {
                    return Err(ToolError::Mismatch(format!("not found in {}", path)));
                }
                let next = if *all {
                    current.replace(old, new)
                } else {
                    current.replacen(old, new, 1)
                };
                std::fs::write(&full, next).map_err(|e| ToolError::Io(e.to_string()))?;
                report.updated += 1;
            }
            PatchOp::Delete { path } => {
                let full = resolve_within(root, path)?;
                if !full.exists() {
                    return Err(ToolError::NotFound(path.clone()));
                }
                if full.is_dir() {
                    std::fs::remove_dir_all(&full).map_err(|e| ToolError::Io(e.to_string()))?;
                } else {
                    std::fs::remove_file(&full).map_err(|e| ToolError::Io(e.to_string()))?;
                }
                report.deleted += 1;
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root(name: &str) -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("durev-{}_{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p.to_string_lossy().to_string()
    }

    #[test]
    fn confinement_blocks_escape() {
        let root = tmp_root("confine");
        assert!(resolve_within(&root, "../evil.txt").is_err());
        assert!(resolve_within(&root, "a/../../evil.txt").is_err());
        assert!(resolve_within(&root, "/abs/path.txt").is_err());
        assert!(resolve_within(&root, "ok/sub.txt").is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn write_read_roundtrip() {
        let root = tmp_root("rw");
        tool_write(&root, "sub/file.txt", "hello\nworld\n").unwrap();
        assert_eq!(tool_read(&root, "sub/file.txt", 0).unwrap(), "hello\nworld\n");
        assert_eq!(tool_read(&root, "sub/file.txt", 1).unwrap(), "hello");
        assert!(tool_read(&root, "missing.txt", 0).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn bash_echo_and_timeout() {
        let root = tmp_root("bash");
        let r = tool_bash(&root, "echo", &["hi".to_string()], 5000).unwrap();
        assert!(!r.timed_out);
        assert_eq!(r.status, 0);
        assert!(r.stdout.contains("hi"));
        let slow = tool_bash(&root, "sleep", &["30".to_string()], 300);
        match slow {
            Ok(v) => assert!(v.timed_out),
            Err(ToolError::Timeout) => {}
            Err(e) => panic!("unexpected: {}", e),
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn patch_add_update_delete() {
        let root = tmp_root("patch");
        let report = apply_patch(
            &root,
            &[
                PatchOp::Add { path: "a.txt".to_string(), content: "one\ntwo\n".to_string() },
                PatchOp::Update {
                    path: "a.txt".to_string(),
                    old: "two".to_string(),
                    new: "2".to_string(),
                    all: false,
                },
            ],
        )
        .unwrap();
        assert_eq!((report.added, report.updated), (1, 1));
        assert_eq!(tool_read(&root, "a.txt", 0).unwrap(), "one\n2\n");
        assert!(apply_patch(&root, &[PatchOp::Update {
            path: "a.txt".to_string(),
            old: "absent".to_string(),
            new: "x".to_string(),
            all: false,
        }])
        .is_err());
        let del = apply_patch(&root, &[PatchOp::Delete { path: "a.txt".to_string() }]).unwrap();
        assert_eq!(del.deleted, 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
