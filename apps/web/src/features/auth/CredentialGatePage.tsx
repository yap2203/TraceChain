import { Link } from 'react-router-dom';

import { Brand } from '../../components/brand/Brand';
import { StatusBadge } from '../../components/ui';

interface CredentialGatePageProps {
  roleLabel: string;
}

export function CredentialGatePage({ roleLabel }: CredentialGatePageProps) {
  return (
    <main className="credential-gate">
      <section>
        <Brand />
        <StatusBadge tone="warning">Access unavailable</StatusBadge>
        <p>{roleLabel} workspace</p>
        <h1>Blockchain authorization is not available yet.</h1>
        <span>
          TraceChain can verify a Company Role Credential locally. This workspace remains locked
          until blockchain role and credential-status verification is implemented.
        </span>
        <div>
          <Link className="primary-link" to="/login#sign-in">
            Return to wallet sign-in
          </Link>
          <Link className="secondary-link" to="/register-company">
            Register a company
          </Link>
        </div>
      </section>
    </main>
  );
}
