import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, CircleX, Info, X } from 'lucide-react';
import { noticeEvent, type NoticeType } from './feedback';
import './notifications.css';

export function Notifications() {
  const [target, setTarget] = useState<Element>(document.body);
  useEffect(() => {
    const update = () => setTarget(document.querySelector('dialog[open]') ?? document.body);
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    update();
    return () => observer.disconnect();
  }, []);
  const [notices, setNotices] = useState<Array<{ id: number; message: string; type: NoticeType }>>(
    [],
  );
  useEffect(() => {
    let nextId = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const receive = (event: Event) => {
      const detail = (event as CustomEvent).detail as { message: string; type: NoticeType };
      const id = ++nextId;
      // A message already on screen is not stacked again (inline alerts re-announce on each load).
      setNotices((current) =>
        current.some((item) => item.type === detail.type && item.message === detail.message)
          ? current
          : [...current.slice(-3), { ...detail, id }],
      );
      const timer = setTimeout(
        () => {
          setNotices((current) => current.filter((item) => item.id !== id));
          timers.delete(timer);
        },
        detail.type === 'error' ? 7000 : 4000,
      );
      timers.add(timer);
    };
    window.addEventListener(noticeEvent, receive);
    return () => {
      window.removeEventListener(noticeEvent, receive);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return createPortal(
    <aside className="app-notifications" aria-label="Notifications">
      {notices.map((notice) => {
        const Icon =
          notice.type === 'error' ? CircleX : notice.type === 'success' ? CircleCheck : Info;
        return (
          <div
            key={notice.id}
            role={notice.type === 'error' ? 'alert' : 'status'}
            className={`app-notification app-notification--${notice.type}`}
          >
            <Icon size={20} aria-hidden="true" />
            <p>{notice.message}</p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() =>
                setNotices((current) => current.filter((item) => item.id !== notice.id))
              }
            >
              <X size={18} />
            </button>
          </div>
        );
      })}
    </aside>,
    target,
  );
}
