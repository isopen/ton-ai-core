let pageFocused = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    pageFocused = document.visibilityState === 'visible';
  });
  window.addEventListener('focus', () => {
    pageFocused = true;
  });
  window.addEventListener('blur', () => {
    pageFocused = false;
  });
}

export function isPageFocused(): boolean {
  return pageFocused;
}
