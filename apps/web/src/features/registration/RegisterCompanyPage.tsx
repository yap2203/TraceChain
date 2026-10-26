import { Link } from 'react-router-dom';

import { Brand } from '../../components/brand/Brand';
import { Button, Card, Input, Select, StatusBadge } from '../../components/ui';

const roleOptions = [
  { label: 'Select a company role', value: '' },
  { label: 'Supplier', value: 'SUPPLIER' },
  { label: 'Manufacturer', value: 'MANUFACTURER' },
  { label: 'Distributor', value: 'DISTRIBUTOR' },
  { label: 'Retailer', value: 'RETAILER' },
] as const;

export function RegisterCompanyPage() {
  return (
    <div className="public-form-page">
      <header className="public-form-header">
        <Link to="/login">
          <Brand />
        </Link>
        <Link className="public-form-header__link" to="/login">
          Return to sign in
        </Link>
      </header>

      <main className="public-form-content">
        <section className="public-form-intro">
          <StatusBadge tone="info">Company onboarding</StatusBadge>
          <h1>Join the trusted supply-chain network.</h1>
          <p>
            Prepare an organisation profile for review by the TraceChain System Admin. Submission
            and credential issuance will be connected in a later phase.
          </p>
          <ol>
            <li>
              <span>01</span>
              <strong>Company details</strong>
            </li>
            <li>
              <span>02</span>
              <strong>Admin review</strong>
            </li>
            <li>
              <span>03</span>
              <strong>Role credential</strong>
            </li>
          </ol>
        </section>

        <Card
          className="registration-card"
          description="This form is a frontend preview and does not send or store data."
          title="Register your company"
        >
          <form className="registration-form" onSubmit={(event) => event.preventDefault()}>
            <Input
              autoComplete="organization"
              label="Registered company name"
              placeholder="e.g. Acme Ingredients Sdn. Bhd."
            />
            <Input label="Registration number" placeholder="Company registration number" />
            <Select label="Supply-chain role" options={roleOptions} />
            <Input autoComplete="name" label="Authorised representative" placeholder="Full name" />
            <Input
              autoComplete="email"
              label="Business email"
              placeholder="name@company.com"
              type="email"
            />
            <Button disabled type="submit">
              Submission available in a later phase
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
