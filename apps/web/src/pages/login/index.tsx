import { Link } from 'react-router-dom';

const companies = [
  { name: 'ABC Ingredients Sdn. Bhd.', role: 'Supplier', icon: 'layers' },
  { name: 'CocoaCraft Manufacturing Sdn. Bhd.', role: 'Manufacturer', icon: 'factory' },
  { name: 'Swift Distribution Sdn. Bhd.', role: 'Distributor', icon: 'truck' },
  { name: 'FreshMart Retail Sdn. Bhd.', role: 'Retailer', icon: 'store' },
] as const;

const benefits = [
  'Verified company identities via SSI credentials',
  'Tamper-evident product records on blockchain',
  'Privacy-preserving selective disclosure',
] as const;

type IconName = (typeof companies)[number]['icon'] | 'shield' | 'wallet' | 'check';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    shield: (
      <>
        <path d="M12 3 5.5 5.8v5.7c0 4.2 2.7 7.9 6.5 9.5 3.8-1.6 6.5-5.3 6.5-9.5V5.8L12 3Z" />
        <path d="m9.6 12 1.6 1.6 3.6-3.8" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3-8 4 8 4 8-4-8-4Z" />
        <path d="m4 11 8 4 8-4M4 15l8 4 8-4" />
      </>
    ),
    factory: (
      <>
        <path d="M3 21V10l6 3V9l6 3V7l6 4v10H3Z" />
        <path d="M7 17h.01M11 17h.01M15 17h.01M19 17h.01" />
      </>
    ),
    truck: (
      <>
        <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z" />
        <circle cx="7" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>
    ),
    store: (
      <>
        <path d="M4 10v11h16V10M3 10l2-6h14l2 6" />
        <path d="M3 10c0 1.3 1 2.3 2.3 2.3S7.7 11.3 7.7 10c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3S21 11.3 21 10M9 21v-5h6v5" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5h14.5A1.5 1.5 0 0 1 20 8v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12" />
        <path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };

  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {paths[name]}
      </g>
    </svg>
  );
}

function Brand() {
  return (
    <div className="brand" aria-label="TraceChain">
      <span className="brand-mark">
        <Icon name="shield" size={23} />
      </span>
      <span>
        <strong>TraceChain</strong>
        <small>Supply Chain SSI</small>
      </span>
    </div>
  );
}

function LoginPage() {
  return (
    <main className="sign-in-page">
      <section className="introduction" aria-labelledby="page-title">
        <div className="introduction-content">
          <Brand />

          <div className="hero-copy">
            <h1 id="page-title">
              Verify every organisation.
              <span>Trace every product.</span>
            </h1>
            <p>
              Use your organisation wallet and verified company credential to access the product
              traceability network.
            </p>
          </div>

          <div className="company-list" aria-label="Verified supply chain participants">
            {companies.map((company) => (
              <article className="company" key={company.name}>
                <span className="company-icon">
                  <Icon name={company.icon} />
                </span>
                <span className="company-details">
                  <strong>{company.name}</strong>
                  <small>{company.role}</small>
                </span>
                <span className="verified">
                  <i />
                  Verified
                </span>
              </article>
            ))}
          </div>

          <ul className="benefit-list">
            {benefits.map((benefit) => (
              <li key={benefit}>
                <span className="benefit-icon">
                  <Icon name="shield" size={14} />
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="authentication" aria-labelledby="sign-in-title">
        <div className="authentication-content">
          <div className="sign-in-card">
            <h2 id="sign-in-title">Sign in to TraceChain</h2>
            <p className="sign-in-intro">
              Connect your organisation&apos;s MetaMask wallet to continue. TraceChain does not use
              email and password authentication.
            </p>

            <dl className="network-panel">
              <div>
                <dt>Required network</dt>
                <dd className="network-name">Sepolia</dd>
              </div>
              <div>
                <dt>Wallet status</dt>
                <dd>Not connected</dd>
              </div>
              <div>
                <dt>Network status</dt>
                <dd>Waiting for connection</dd>
              </div>
            </dl>

            <label className="demo-label" htmlFor="demo-company">
              Demo mode — simulate wallet
            </label>
            <select className="company-select" defaultValue="supplier" id="demo-company">
              <option value="supplier">ABC Ingredients — Supplier</option>
              <option value="manufacturer">CocoaCraft Manufacturing — Manufacturer</option>
              <option value="distributor">Swift Distribution — Distributor</option>
              <option value="retailer">FreshMart Retail — Retailer</option>
            </select>

            <div className="wallet-row">
              <span className="wallet-mark">
                <Icon name="wallet" />
              </span>
              <span>
                <strong>MetaMask</strong>
                <small>Browser wallet extension</small>
              </span>
            </div>

            <button className="connect-button" type="button">
              Connect MetaMask
            </button>
            <Link className="register-button" to="/register-company">
              Register a New Company
            </Link>
          </div>

          <aside className="security-note">
            <Icon name="shield" size={16} />
            <p>TraceChain never requests your private key, MetaMask password or recovery phrase.</p>
          </aside>

          <button className="wallet-help" type="button">
            Why do I need to connect a wallet?
          </button>
        </div>
      </section>
    </main>
  );
}

export default LoginPage;
