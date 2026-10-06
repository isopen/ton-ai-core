// Shared jest stub for @ton/* packages that must stay isolated from network IO.
// Only pure, side-effect-free helpers are re-exported for real. Everything
// else stays an empty stub so tests cannot accidentally hit the network.
function fromNano(src) {
  const value = typeof src === 'bigint' ? src : BigInt(src);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(10, '0');
  const intPart = digits.slice(0, -9).replace(/^0+(?=\d)/, '') || '0';
  const fracPart = digits.slice(-9).replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${fracPart ? `.${fracPart}` : ''}`;
}

module.exports = { fromNano };
