module.exports = function (source) {
    return source.replace(/window\.crypto/g, 'globalThis.crypto');
};
