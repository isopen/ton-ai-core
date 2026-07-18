// Paste this in browser DevTools console to clear OPFS binlog cache
(async () => {
    const root = await navigator.storage.getDirectory();
    try {
        const dir = await root.getDirectoryHandle('_7a');
        for (const name of ['binlog', 'binlog.new']) {
            try { await dir.removeEntry(name); console.log('removed', name); } catch {}
        }
        console.log('done — reload the page and log in again');
    } catch (e) {
        console.log('nothing to clear:', e.message);
    }
})();
