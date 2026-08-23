import { useEffect, useRef, useState } from 'react';

type TurnstileInstance = {
  render(
    container: HTMLElement,
    options: Record<string, unknown>,
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileInstance;
  }
}

const TURNSTILE_SCRIPT_ID = 'epet-turnstile-script';
const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<TurnstileInstance> | null = null;

const loadTurnstile = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileInstance>((resolve, reject) => {
    const existing = document.getElementById(
      TURNSTILE_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    let settled = false;
    const finish = (
      instance: TurnstileInstance | null,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (instance) {
        resolve(instance);
        return;
      }
      script.remove();
      reject(error ?? new Error('TURNSTILE_UNAVAILABLE'));
    };
    const handleLoad = () => finish(
      window.turnstile ?? null,
      new Error('TURNSTILE_UNAVAILABLE'),
    );
    const handleError = () => finish(
      null,
      new Error('TURNSTILE_LOAD_FAILED'),
    );
    const timeoutId = window.setTimeout(
      () => finish(null, new Error('TURNSTILE_LOAD_TIMEOUT')),
      10_000,
    );
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptPromise = null;
    throw error;
  });
  return scriptPromise;
};

export const TurnstileWidget = ({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: 'login' | 'register' | 'forgot';
  onToken: (token: string) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  onTokenRef.current = onToken;

  useEffect(() => {
    let disposed = false;
    let widgetId: string | null = null;
    onTokenRef.current('');
    void loadTurnstile()
      .then((turnstile) => {
        if (disposed || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          appearance: 'interaction-only',
          theme: 'auto',
          size: 'flexible',
          'response-field': false,
          'refresh-expired': 'auto',
          callback: (token: string) => {
            setStatus('ready');
            onTokenRef.current(token);
          },
          'expired-callback': () => {
            setStatus('loading');
            onTokenRef.current('');
          },
          'error-callback': () => {
            setStatus('error');
            onTokenRef.current('');
          },
          'unsupported-callback': () => {
            setStatus('error');
            onTokenRef.current('');
          },
        });
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });
    return () => {
      disposed = true;
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
      onTokenRef.current('');
    };
  }, [action, siteKey]);

  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div ref={containerRef} />
      <p className="mt-2 text-xs leading-5 text-slate-500" role="status">
        {status === 'error'
          ? '無法完成安全驗證，請檢查網路或關閉阻擋器後重試。'
          : status === 'ready'
            ? '安全驗證已完成。'
            : '正在進行安全驗證…'}
      </p>
    </div>
  );
};
