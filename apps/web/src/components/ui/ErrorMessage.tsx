interface ErrorMessageProps {
  message: string;
  title?: string;
}

export function ErrorMessage({ message, title = 'Something went wrong' }: ErrorMessageProps) {
  return (
    <div className="error-message" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}
