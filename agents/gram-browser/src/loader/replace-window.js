// Replace window.crypto with globalThis.crypto for SharedWorker compatibility
module.exports = function (source) {
    return source.replace(/window\.crypto/g, 'globalThis.crypto');
};
