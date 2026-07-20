import { h, Fragment } from '../framework/jsx-runtime.js';
import { Scrollable } from '../primitives/scrollable.js';
import { useState, useEffect, useRef } from '../framework/hooks.js';
import type { AppState } from '../types.js';
import { t } from '../locale.js';
import { S } from '../strings.js';

interface BinlogEventItem {
  off: number;
  size: number;
  type: number;
  typeName: string;
  id: string;
  key?: string;
  value?: string;
  flags?: number;
}

interface TdSessionEvent {
  type: number;
  typeName: string;
  dcId?: number;
  authKeyId?: string;
  serverSalt?: string;
  keyLen?: number;
  flags?: number;
  authenticated?: boolean;
  passwordPending?: boolean;
  offset?: number;
  hash?: string;
  data?: string;
}

interface CacheInspectData {
  dbKeys: Array<{ key: string; value: string }>;
  opfsRoot: Array<{ name: string; size: number }>;
  opfs7a: Array<{ name: string; size: number }>;
  binlogInfo: { size: number; exists: boolean; events?: BinlogEventItem[] };
  tdsessionInfo: { size: number; exists: boolean; events?: TdSessionEvent[] };
  avatars?: Array<{ opfsName: string; dataUri: string }>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function tryPrettyJson(raw: string): { formatted: string; isJson: boolean } {
  try {
    const parsed = JSON.parse(raw);
    return { formatted: JSON.stringify(parsed, null, 2), isJson: true };
  } catch {
    return { formatted: raw, isJson: false };
  }
}

function KeyValueRow({ k, v, onDelete }: { k: string; v: string; onDelete: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const { formatted, isJson } = tryPrettyJson(v);
  const byteLen = new TextEncoder().encode(v).length;
  return (
    <div class="tgui-cache-kv-row">
      <div class="tgui-cache-kv-key" onClick={() => setOpen(!open)}>
        <span class="tgui-cache-kv-toggle">{open ? '▼' : '▶'}</span>
        <span class="tgui-cache-kv-key-text">{k}</span>
        <span class="tgui-cache-kv-json-badge">{isJson ? '{ }' : 'str'}</span>
        <span class="tgui-cache-kv-size">{formatSize(byteLen)}</span>
        <button class="tgui-cache-kv-del" title="Delete key"
          onClick={(e: MouseEvent) => { e.stopPropagation(); onDelete(k); }}>
          ✕
        </button>
      </div>
      {open && (
        <pre class="tgui-cache-kv-value">{formatted}</pre>
      )}
    </div>
  );
}

function TdSessionRow({ ev }: { ev: TdSessionEvent }) {
  const hasStructured = ev.dcId !== undefined || ev.flags !== undefined || ev.offset !== undefined || ev.hash !== undefined;
  const summary = hasStructured
    ? ev.type === 1 || ev.type === 2
      ? `dcId=${ev.dcId} authKeyId=${ev.authKeyId} salt=${ev.serverSalt}`
      : ev.type === 3
        ? `authenticated=${ev.authenticated} passwordPending=${ev.passwordPending}`
        : ev.type === 4
          ? `offset=${ev.offset}`
          : ev.type === 5
            ? `hash=${ev.hash}`
            : ''
    : (ev.data ?? '');

  return (
    <details class="tgui-cache-bevent">
      <summary class="tgui-cache-bevent-header">
        <span class="tgui-cache-bevent-type">{ev.typeName}</span>
        <span class="tgui-cache-bevent-key">{summary}</span>
      </summary>
      <div class="tgui-cache-kv-value" style="padding:6px 12px 6px 32px;font-family:var(--font-mono)">
        {hasStructured ? (
          (ev.type === 1 || ev.type === 2) ? (
            <>
              <div>dcId: <b>{ev.dcId ?? '?'}</b></div>
              <div>authKeyId: <b>{ev.authKeyId ?? '?'}</b></div>
              <div>serverSalt: <b>{ev.serverSalt ?? '?'}</b></div>
              <div>keyLen: <b>{ev.keyLen ?? '?'}</b></div>
            </>
          ) : ev.type === 3 ? (
            <>
              <div>flags: <b>{ev.flags ?? '?'}</b> (0b{ev.flags?.toString(2) ?? '?'})</div>
              <div>authenticated: <b>{String(ev.authenticated)}</b></div>
              <div>passwordPending: <b>{String(ev.passwordPending)}</b></div>
            </>
          ) : ev.type === 4 ? (
            <div>offset: <b>{ev.offset ?? '?'}</b></div>
          ) : ev.type === 5 ? (
            <div>hash: <b>{ev.hash ?? '?'}</b></div>
          ) : null
        ) : (
          <div style="white-space:pre-wrap;word-break:break-all">{ev.data}</div>
        )}
      </div>
    </details>
  );
}

function SectionHeader({ title, count, expanded, onToggle }: {
  title: string; count?: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <div class="tgui-cache-section-header" onClick={onToggle}>
      <span class="tgui-cache-toggle">{expanded ? '▼' : '▶'}</span>
      <span class="tgui-cache-section-title">{title}</span>
      {count != null && <span class="tgui-cache-section-count">{count}</span>}
    </div>
  );
}

export function CacheView({ }: { state: AppState }) {
  const [data, setData] = useState<CacheInspectData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sec, setSec] = useState({ db: false, opfs: false, binlog: false, avatars: false });
  const [binlogRaw, setBinlogRaw] = useState<string | null>(null);
  const [showBinlogRaw, setShowBinlogRaw] = useState(false);

  function fetchData() {
    setLoading(true);
    setBinlogRaw(null);
    setShowBinlogRaw(false);
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as CacheInspectData;
      setData(detail);
      setLoading(false);
      window.removeEventListener('tg-inspect-cache-data', handler as EventListener);
    };
    window.addEventListener('tg-inspect-cache-data', handler as EventListener);
    window.dispatchEvent(new CustomEvent('tg-inspect-cache'));
    setTimeout(() => {
      window.removeEventListener('tg-inspect-cache-data', handler as EventListener);
      setLoading(false);
    }, 10000);
  }

  useEffect(() => { fetchData(); }, []);

  function loadBinlogRaw() {
    setShowBinlogRaw(true);
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.hex) setBinlogRaw(detail.hex);
      window.removeEventListener('tg-cache-binlog-raw', handler as EventListener);
    };
    window.addEventListener('tg-cache-binlog-raw', handler as EventListener);
    window.dispatchEvent(new CustomEvent('tg-cache-read-binlog'));
  }

  function deleteKey(key: string) {
    window.dispatchEvent(new CustomEvent('tg-cache-delete-key', { detail: { key } }));
    setData(prev => {
      if (!prev) return prev;
      return { ...prev, dbKeys: prev.dbKeys.filter(e => e.key !== key) };
    });
  }

  function deleteOpfsFile(dir: string, name: string) {
    window.dispatchEvent(new CustomEvent('tg-cache-delete-opfs-file', { detail: { dir, name } }));
    setData(prev => {
      if (!prev) return prev;
      if (dir === '_7a') return { ...prev, opfs7a: prev.opfs7a.filter(f => f.name !== name) };
      return { ...prev, opfsRoot: prev.opfsRoot.filter(f => f.name !== name) };
    });
  }

  function deleteAvatar(opfsName: string) {
    window.dispatchEvent(new CustomEvent('tg-cache-delete-avatar', { detail: { opfsName } }));
    setData(prev => prev ? { ...prev, avatars: prev.avatars?.filter(a => a.opfsName !== opfsName) } : prev);
  }

  function deleteAllAvatars() {
    const names = avatars.map(a => a.opfsName);
    window.dispatchEvent(new CustomEvent('tg-cache-delete-all-avatars', { detail: { names } }));
    setData(prev => prev ? { ...prev, avatars: [] } : prev);
  }

  function deleteBinlogFile(target: string) {
    window.dispatchEvent(new CustomEvent('tg-cache-delete-binlog', { detail: { target } }));
    if (target === 'all') {
      setData(prev => prev ? {
        ...prev,
        binlogInfo: { size: 0, exists: false, events: [] },
        tdsessionInfo: { size: 0, exists: false, events: [] },
      } : prev);
    } else if (target === 'binlog') {
      setData(prev => prev ? { ...prev, binlogInfo: { size: 0, exists: false, events: [] } } : prev);
    } else if (target === 'tdsession') {
      setData(prev => prev ? { ...prev, tdsessionInfo: { size: 0, exists: false, events: [] } } : prev);
    }
  }

  const totalDbSize = data?.dbKeys.reduce((acc, { value }) => acc + new TextEncoder().encode(value).length, 0) ?? 0;
  const totalOpfsSize = data?.opfsRoot.reduce((acc, f) => acc + f.size, 0) ?? 0;
  const total7aSize = data?.opfs7a.reduce((acc, f) => acc + f.size, 0) ?? 0;
  const binlogEvents = data?.binlogInfo?.events ?? [];
  const tdEvents = data?.tdsessionInfo?.events ?? [];
  const avatars = data?.avatars ?? [];
  const binlogSets = binlogEvents.filter(e => e.type === 1).length;
  const binlogDels = binlogEvents.filter(e => e.type === 2).length;
  const binlogSys = binlogEvents.filter(e => e.type < 0).length;

  const sortedKeys = data?.dbKeys
    ? [...data.dbKeys].sort((a, b) => a.key.localeCompare(b.key))
    : [];

  return (
    <Scrollable className="tgui-cache">
      <div class="tgui-cache-title">{t(S.CACHE_TITLE)}</div>

      <div class="tgui-cache-toolbar">
        <button class="tgui-cache-refresh" onClick={fetchData}>
          ↻ {t(S.CACHE_REFRESH)}
        </button>
      </div>

      {loading && <div class="tgui-cache-loading">Loading...</div>}

      {data && (
        <>
          {/* Summary */}
          <div class="tgui-cache-summary">
            <div class="tgui-cache-summary-item">
              <span class="tgui-cache-summary-label">DB keys</span>
              <span class="tgui-cache-summary-value">{data.dbKeys.length}</span>
            </div>
            <div class="tgui-cache-summary-item">
              <span class="tgui-cache-summary-label">DB size</span>
              <span class="tgui-cache-summary-value">{formatSize(totalDbSize)}</span>
            </div>
            <div class="tgui-cache-summary-item">
              <span class="tgui-cache-summary-label">OPFS files</span>
              <span class="tgui-cache-summary-value">{data.opfsRoot.length + data.opfs7a.length}</span>
            </div>
            <div class="tgui-cache-summary-item">
              <span class="tgui-cache-summary-label">OPFS size</span>
              <span class="tgui-cache-summary-value">{formatSize(totalOpfsSize + total7aSize)}</span>
            </div>
            <div class="tgui-cache-summary-item">
              <span class="tgui-cache-summary-label">Avatars</span>
              <span class="tgui-cache-summary-value">{avatars.length}</span>
            </div>
            <div class="tgui-cache-summary-item">
              <span class="tgui-cache-summary-label">Binlog ev</span>
              <span class="tgui-cache-summary-value">{binlogEvents.length}</span>
            </div>
            <div class="tgui-cache-summary-item">
              <span class="tgui-cache-summary-label">Session ev</span>
              <span class="tgui-cache-summary-value">{tdEvents.length}</span>
            </div>
          </div>

          {/* DB Keys */}
          <div class="tgui-cache-section">
            <SectionHeader
              title={t(S.CACHE_DB_KEYS)}
              count={data.dbKeys.length}
              expanded={sec.db}
              onToggle={() => setSec(s => ({ ...s, db: !s.db }))}
            />
            {sec.db && (
              <div class="tgui-cache-kv-list">
                {data.dbKeys.length === 0 && <div class="tgui-cache-empty">(empty)</div>}
                {sortedKeys.map(({ key, value }) => (
                  <KeyValueRow key={key} k={key} v={value} onDelete={deleteKey} />
                ))}
              </div>
            )}
          </div>

          {/* OPFS Files */}
          <div class="tgui-cache-section">
            <SectionHeader
              title={t(S.CACHE_OPFS_FILES)}
              count={data.opfsRoot.length + data.opfs7a.length}
              expanded={sec.opfs}
              onToggle={() => setSec(s => ({ ...s, opfs: !s.opfs }))}
            />
            {sec.opfs && (
              <div class="tgui-cache-opfs">
                <div class="tgui-cache-opfs-dir">
                  <div class="tgui-cache-opfs-dir-name">/</div>
                  {data.opfsRoot.length === 0 && <div class="tgui-cache-empty">(empty)</div>}
                  {[...data.opfsRoot].sort((a, b) => a.name.localeCompare(b.name)).map(f => (
                    <div class="tgui-cache-opfs-file">
                      <span class="tgui-cache-opfs-file-name">{f.name}</span>
                      <span class="tgui-cache-opfs-file-size">{formatSize(f.size)}</span>
                      <button class="tgui-cache-kv-del" title="Delete file"
                        onClick={(e: MouseEvent) => { e.stopPropagation(); deleteOpfsFile('root', f.name); }}>
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                {data.opfs7a.length > 0 && (
                  <div class="tgui-cache-opfs-dir">
                    <div class="tgui-cache-opfs-dir-name">/_7a/</div>
                    {[...data.opfs7a].sort((a, b) => a.name.localeCompare(b.name)).map(f => (
                      <div class="tgui-cache-opfs-file">
                        <span class="tgui-cache-opfs-file-name">{f.name}</span>
                        <span class="tgui-cache-opfs-file-size">{formatSize(f.size)}</span>
                        <button class="tgui-cache-kv-del" title="Delete file"
                          onClick={(e: MouseEvent) => { e.stopPropagation(); deleteOpfsFile('_7a', f.name); }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Avatars */}
          <div class="tgui-cache-section">
            <SectionHeader
              title={'Avatars'}
              count={avatars.length}
              expanded={sec.avatars}
              onToggle={() => setSec(s => ({ ...s, avatars: !s.avatars }))}
            />
            {sec.avatars && (
              <div class="tgui-cache-kv-list">
                <div class="tgui-cache-binlog-bar">
                  {avatars.length > 0 && (
                    <button class="tgui-cache-bevent-del-all-btn"
                      onClick={deleteAllAvatars}>
                      Delete all avatars
                    </button>
                  )}
                </div>
                {avatars.length === 0 && <div class="tgui-cache-empty">(empty)</div>}
                {avatars.map(a => (
                  <div class="tgui-cache-kv-row" key={a.opfsName}>
                    <div class="tgui-cache-kv-key" style="display:flex;align-items:center;gap:8px">
                      <img src={a.dataUri} style="width:32px;height:32px;border-radius:50%;flex-shrink:0" />
                      <span style="font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title={a.opfsName}>{a.opfsName.slice(0, 24)}…</span>
                      <button class="tgui-cache-kv-del" title="Delete avatar"
                        onClick={(e: MouseEvent) => { e.stopPropagation(); deleteAvatar(a.opfsName); }}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Binlog + Session */}
          <div class="tgui-cache-section">
            <SectionHeader
              title={t(S.CACHE_BINLOG)}
              count={binlogEvents.length + tdEvents.length}
              expanded={sec.binlog}
              onToggle={() => setSec(s => ({ ...s, binlog: !s.binlog }))}
            />
            {sec.binlog && (
              <div class="tgui-cache-binlog">
                {/* Binlog file summary */}
                <div class="tgui-cache-binlog-bar">
                  <div class="tgui-cache-binlog-bar-item">
                    <span class="tgui-cache-binlog-bar-label">binlog</span>
                    <span class="tgui-cache-binlog-bar-val">
                      {data.binlogInfo.exists ? formatSize(data.binlogInfo.size) : '—'}
                    </span>
                  </div>
                  <div class="tgui-cache-binlog-bar-item">
                    <span class="tgui-cache-binlog-bar-label">SET</span>
                    <span class="tgui-cache-binlog-bar-val">{binlogSets}</span>
                  </div>
                  <div class="tgui-cache-binlog-bar-item">
                    <span class="tgui-cache-binlog-bar-label">DEL</span>
                    <span class="tgui-cache-binlog-bar-val">{binlogDels}</span>
                  </div>
                  <div class="tgui-cache-binlog-bar-item">
                    <span class="tgui-cache-binlog-bar-label">Sys</span>
                    <span class="tgui-cache-binlog-bar-val">{binlogSys}</span>
                  </div>
                  {data.binlogInfo.exists && (
                    <button class="tgui-cache-bevent-raw-btn" onClick={loadBinlogRaw}>
                      {showBinlogRaw ? 'Hex ▼' : 'Raw hex'}
                    </button>
                  )}
                  {data.binlogInfo.exists && (
                    <button class="tgui-cache-bevent-del-btn" title="Delete binlog"
                      onClick={() => deleteBinlogFile('binlog')}>✕</button>
                  )}
                </div>

                {/* tdsession summary */}
                <div class="tgui-cache-binlog-bar">
                  <div class="tgui-cache-binlog-bar-item">
                    <span class="tgui-cache-binlog-bar-label">tdsession</span>
                    <span class="tgui-cache-binlog-bar-val">
                      {data.tdsessionInfo.exists ? formatSize(data.tdsessionInfo.size) : '—'}
                    </span>
                  </div>
                  <div class="tgui-cache-binlog-bar-item">
                    <span class="tgui-cache-binlog-bar-label">Events</span>
                    <span class="tgui-cache-binlog-bar-val">{tdEvents.length}</span>
                  </div>
                  {data.tdsessionInfo.exists && (
                    <button class="tgui-cache-bevent-del-btn" title="Delete tdsession"
                      onClick={() => deleteBinlogFile('tdsession')}>✕</button>
                  )}
                </div>

                {/* Delete all button */}
                {(data.binlogInfo.exists || data.tdsessionInfo.exists) && (
                  <div class="tgui-cache-binlog-bar" style="border-top:1px solid var(--border);padding-top:8px;margin-top:4px">
                    <button class="tgui-cache-bevent-del-all-btn"
                      onClick={() => deleteBinlogFile('all')}>
                      Delete all binlog files
                    </button>
                  </div>
                )}

                {showBinlogRaw && binlogRaw !== null && (
                  <pre class="tgui-cache-binlog-hex">{binlogRaw}</pre>
                )}
                {showBinlogRaw && binlogRaw === null && (
                  <div class="tgui-cache-loading">Loading raw data...</div>
                )}

                {/* TdSession events */}
                {tdEvents.length > 0 && (
                  <div class="tgui-cache-bevent-list" style="margin-top:8px">
                    <div class="tgui-cache-bevent-section-label">Session events</div>
                    {tdEvents.map((ev, i) => (
                      <TdSessionRow key={i} ev={ev} />
                    ))}
                  </div>
                )}

                
              </div>
            )}
          </div>
        </>
      )}
    </Scrollable>
  );
}
