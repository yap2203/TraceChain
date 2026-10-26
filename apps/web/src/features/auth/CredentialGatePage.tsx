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
        <h1>Company Role Credential verification is required.</h1>
        <span>
          Wallet authentication proves wallet ownership only. Stakeholder access will remain locked
          until credential-based role verification is implemented.
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
