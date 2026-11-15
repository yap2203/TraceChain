import { useEffect } from 'react';
import { notify, readableError } from './feedback';
interface ErrorMessageProps {
  message: string;
  title?: string;
}

export function ErrorMessage({ message, title = 'Something went wrong' }: ErrorMessageProps) {
  const text = readableError(message);
  useEffect(() => notify(text, 'error'), [text]);
  return (
    <div className="error-message" role="alert">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}
