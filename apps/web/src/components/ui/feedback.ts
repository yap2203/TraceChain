export type NoticeType = 'success' | 'error' | 'info';
export const noticeEvent = 'tracechain:notice';

/** Extract a short user-facing reason without reflecting RPC payloads, URLs or credentials. */
export function readableError(
  value: unknown,
  fallback = 'The action could not be completed. Please try again.',
): string {
  let candidate: any = value;
  if (typeof candidate === 'string' && /^[\s]*[\[{]/.test(candidate)) {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return fallback;
    }
  }
  const code = candidate?.code ?? candidate?.error?.code ?? candidate?.info?.error?.code;
  const text =
    typeof candidate === 'string'
      ? candidate
      : (candidate?.reason ??
        candidate?.error?.message ??
        candidate?.info?.error?.message ??
        candidate?.shortMessage ??
        candidate?.message);
  if (
    code === 4001 ||
    code === 'ACTION_REJECTED' ||
    /user (denied|rejected)|rejected the request/i.test(text ?? '')
  )
    return 'The wallet request was cancelled. You can try again when ready.';
  if (/nonce too high|stale nonce/i.test(text ?? ''))
    return 'MetaMask has an outdated transaction count. Clear this account’s activity and nonce data in MetaMask, then retry.';
  if (code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(text ?? ''))
    return 'Your wallet needs more test ETH to pay the network fee.';
  if (code === 'CALL_EXCEPTION' || /execution reverted/i.test(text ?? ''))
    return 'The blockchain rejected this action. Refresh the record and check its current state and your permissions.';
  if (
    /failed to fetch|networkerror|ECONNREFUSED|fetch failed|network request failed/i.test(
      text ?? '',
    )
  )
    return 'Unable to reach the service. Check your connection and try again.';
  if (typeof text !== 'string' || !text.trim()) return fallback;
  if (/^[\s]*[\[{]/.test(text)) return readableError(text, fallback);
  if (
    text.length > 400 ||
    /could not coalesce|error\s*=\s*[{[]|payload\s*=|"jsonrpc"|"params"|stack trace|0x[0-9a-f]{64,}|https?:\/\//i.test(
      text,
    )
  )
    return fallback;
  return text.replace(/\s+/g, ' ').trim();
}

let lastNotice = { key: '', at: 0 };
export function notify(message: string, type: NoticeType = 'info') {
  const text = type === 'error' ? readableError(message) : message;
  if (!text || typeof window === 'undefined') return;
  const key = type + ':' + text,
    now = Date.now();
  if (lastNotice.key === key && now - lastNotice.at < 1500) return;
  lastNotice = { key, at: now };
  window.dispatchEvent(new CustomEvent(noticeEvent, { detail: { message: text, type } }));
}

export function apiErrorMessage(value: unknown, fallback: string) {
  const message = readableError(value, fallback);
  notify(message, 'error');
  return message;
}
export const reportError = apiErrorMessage;
