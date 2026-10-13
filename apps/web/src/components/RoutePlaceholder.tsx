import { Link } from 'react-router-dom';

interface RoutePlaceholderProps {
  area: string;
  title: string;
}

export function RoutePlaceholder({ area, title }: RoutePlaceholderProps) {
  return (
    <main className="route-placeholder">
      <section>
        <p>{area}</p>
        <h1>{title}</h1>
        <span>This route is ready for its Phase 2 implementation.</span>
        <Link to="/login">Return to sign in</Link>
      </section>
    </main>
  );
}
