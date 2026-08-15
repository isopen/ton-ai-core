let pageFocused = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    pageFocused = document.visibilityState === 'visible';
  });
}

export function isPageFocused(): boolean {
  return pageFocused;
}
