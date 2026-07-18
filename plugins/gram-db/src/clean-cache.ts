(async () => {
  console.log('[CLEAN-CACHE]');
  try {
    const dir = await navigator.storage.getDirectory();
    const entries = ['binlog', 'tdsession', '_7a'];
    for (const name of entries) {
      try {
        await dir.removeEntry(name, { recursive: true });
        console.log('[CLEAN-CACHE] removed: ' + name);
      } catch {
        console.log('[CLEAN-CACHE] not found: ' + name);
      }
    }
    console.log('[CLEAN-CACHE] done');
  } catch (e) {
    console.log('[CLEAN-CACHE] error:', String(e));
  }
})();
