import { RefreshCw } from 'lucide-react';
import { Alert } from './Alert';
import { Btn } from './Button';

/** Shown in place of a page whose first load failed, so the user can recover without reloading. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid gap-[12px]">
      <Alert type="error" message={message} />
      <div>
        <Btn variant="outline" icon={<RefreshCw size={16} />} onClick={onRetry}>
          Try again
        </Btn>
      </div>
    </div>
  );
}
