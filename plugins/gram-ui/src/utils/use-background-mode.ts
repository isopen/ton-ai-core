import { useEffect } from '@ton-ai/atom/hooks';

export function useBackgroundMode(onBlur?: () => void, onFocus?: () => void, isDisabled = false) {
  useEffect(() => {
    if (isDisabled) return;
    const handleBlur = () => {
      if (!document.hasFocus()) onBlur?.();
    };
    const handleFocus = () => {
      if (document.hasFocus()) onFocus?.();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') onBlur?.();
      else onFocus?.();
    };
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [onBlur, onFocus, isDisabled]);
}
