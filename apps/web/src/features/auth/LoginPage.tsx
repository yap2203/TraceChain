import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Brand } from '../../components/brand/Brand';
import { shortenAddress, useWalletAuthentication } from './useWalletAuthentication';

const learningTabs = {
  process: {
    label: 'How it works',
    title: 'Three steps to trusted traceability',
    items: [
      ['01', 'Verify', 'Confirm the organisation and its role credential.'],
      ['02', 'Trace', 'Link ingredients, products and custody events.'],
      ['03', 'Receive', 'Confirm transfers with the intended wallet.'],
    ],
  },
  roles: {
    label: 'Roles',
    title: 'One network for every participant',
    items: [
      ['01', 'System Admin', 'Approves companies.'],
      ['02', 'Supplier', 'Issues ingredient evidence.'],
      ['03', 'Manufacturer', 'Creates product batches.'],
      ['04', 'Distributor', 'Manages custody transfers.'],
      ['05', 'Retailer', 'Confirms receipt and traces products.'],
    ],
  },
  security: {
    label: 'Security',
    title: 'Trust without exposing sensitive data',
    items: [
      ['01', 'Your keys', 'Remain inside your wallet.'],
      ['02', 'Your credentials', 'Stay off-chain.'],
      ['03', 'Your access', 'Requires cryptographic verification.'],
    ],
  },
} as const;

type LearningTab = keyof typeof learningTabs;
type IconName = 'shield' | 'wallet' | 'check' | 'leaf' | 'factory' | 'truck' | 'store' | 'blocks';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    shield: (
      <>
        <path d="M12 3 5.5 5.8v5.7c0 4.2 2.7 7.9 6.5 9.5 3.8-1.6 6.5-5.3 6.5-9.5V5.8L12 3Z" />
        <path d="m9.6 12 1.6 1.6 3.6-3.8" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6.5h14.5A1.5 1.5 0 0 1 20 8v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12" />
        <path d="M16 11h5v5h-5a2.5 2.5 0 0 1 0-5Z" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    leaf: (
      <>
        <path d="M20 4C12 4 6 8 5 15c4 1 8 0 11-3 2-2 3-5 4-8Z" />
        <path d="M4 20c2-5 6-8 12-10" />
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
        <path d="M3 10c0 1.3 1 2.3 2.3 2.3S7.7 11.3 7.7 10c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3S21 11.3 21 10" />
      </>
    ),
    blocks: (
      <>
        <path d="m8 3-5 3 5 3 5-3-5-3ZM16 9l-5 3 5 3 5-3-5-3Z" />
        <path d="M3 6v6l5 3 3-1.8M13 6v4.8M11 12v6l5 3 5-3v-6" />
      </>
    ),
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

function LoginPage() {
  const [activeTab, setActiveTab] = useState<LearningTab>('process');
  const [showWalletHelp, setShowWalletHelp] = useState(false);
  const { connect, logout, state: walletState, switchToSepolia } = useWalletAuthentication();
  const activeLearningTab = learningTabs[activeTab];
  const isWalletBusy = ['connecting', 'restoring', 'signing', 'verifying'].includes(
    walletState.phase,
  );
  const connectButtonLabel = {
    authenticated: 'Wallet verified',
    connecting: 'Connecting…',
    error: 'Try again',
    idle: 'Connect MetaMask',
    rejected: 'Try again',
    restoring: 'Restoring session…',
    signing: 'Waiting for signature…',
    switch_required: 'Switch to Sepolia',
    unavailable: 'MetaMask not detected',
    verifying: 'Verifying signature…',
  }[walletState.phase];

  useEffect(() => {
    const revealSections = document.querySelectorAll<HTMLElement>('[data-reveal-section]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      revealSections.forEach((section) => section.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.14 },
    );

    revealSections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-page" id="top">
      {isWalletBusy && <LoadingIndicator fullScreen label={connectButtonLabel} />}
      <header className="site-header">
        <a className="header-brand" href="#top" aria-label="TraceChain home">
          <Brand />
        </a>
        <nav aria-label="Landing page navigation">
          <a href="#overview">Overview</a>
          <a href="#understand">How it works</a>
          <a href="#security">Security</a>
        </nav>
        <a className="header-action" href="#sign-in">
          Connect wallet
        </a>
      </header>

      <main>
        <section className="sign-in-page" id="overview">
          <section className="introduction" aria-labelledby="page-title">
            <div className="introduction-content">
              <p className="hero-kicker">
                <span /> Sepolia network
              </p>
              <div className="hero-copy">
                <h1 id="page-title">
                  Trusted identities.
                  <span>Traceable products.</span>
                </h1>
                <p>
                  Secure supply-chain access through verified credentials and wallet signatures.
                </p>
              </div>

              <div className="hero-actions">
                <a className="primary-link" href="#sign-in">
                  Connect your wallet
                </a>
                <a className="secondary-link" href="#understand">
                  See how it works <span aria-hidden="true">↓</span>
                </a>
              </div>

              <div className="network-visual" aria-label="TraceChain supply chain flow">
                <div className="network-line" aria-hidden="true" />
                <div className="network-node">
                  <span>
                    <Icon name="leaf" size={20} />
                  </span>
                  <strong>Ingredient</strong>
                </div>
                <div className="network-node">
                  <span>
                    <Icon name="factory" size={20} />
                  </span>
                  <strong>Production</strong>
                </div>
                <div className="network-node">
                  <span>
                    <Icon name="truck" size={20} />
                  </span>
                  <strong>Distribution</strong>
                </div>
                <div className="network-node">
                  <span>
                    <Icon name="store" size={20} />
                  </span>
                  <strong>Retail</strong>
                </div>
              </div>

              <ul className="capability-list" aria-label="TraceChain capabilities">
                <li>
                  <Icon name="check" size={14} />
                  Verified roles
                </li>
                <li>
                  <Icon name="check" size={14} />
                  Private credentials
                </li>
                <li>
                  <Icon name="check" size={14} />
                  Auditable custody
                </li>
              </ul>
            </div>
          </section>

          <section className="authentication" id="sign-in" aria-labelledby="sign-in-title">
            <div className="authentication-content">
              <div className="sign-in-card">
                <div className="card-heading">
                  <span className="live-indicator">
                    <i />
                    Sepolia
                  </span>
                  <span>Secure access</span>
                </div>

                <h2 id="sign-in-title">Connect to TraceChain</h2>
                <p className="sign-in-intro">Use your organisation&apos;s MetaMask wallet.</p>

                <dl className="network-panel">
                  <div>
                    <dt>Wallet</dt>
                    <dd
                      className={
                        walletState.phase === 'error' ||
                        walletState.phase === 'rejected' ||
                        walletState.phase === 'unavailable'
                          ? 'status-error'
                          : walletState.phase === 'authenticated'
                            ? 'status-success'
                            : ''
                      }
                    >
                      {walletState.address ? shortenAddress(walletState.address) : 'Not connected'}
                    </dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd
                      className={
                        walletState.phase === 'switch_required' ? 'status-error' : 'network-name'
                      }
                    >
                      {walletState.phase === 'switch_required' ? 'Switch required' : 'Sepolia'}
                    </dd>
                  </div>
                  <div>
                    <dt>Credential</dt>
                    <dd>
                      {walletState.phase === 'authenticated'
                        ? 'Verification required'
                        : 'Not verified'}
                    </dd>
                  </div>
                </dl>

                <div className="wallet-row">
                  <span className="wallet-mark">
                    <Icon name="wallet" />
                  </span>
                  <span>
                    <strong>MetaMask</strong>
                    <small>Your keys stay in your wallet</small>
                  </span>
                </div>

                {walletState.phase === 'authenticated' ? (
                  <button className="logout-button" onClick={() => void logout()} type="button">
                    Log out {walletState.address ? shortenAddress(walletState.address) : ''}
                  </button>
                ) : (
                  <button
                    className={`connect-button${isWalletBusy ? ' is-busy' : ''}`}
                    disabled={isWalletBusy || walletState.phase === 'unavailable'}
                    onClick={
                      walletState.phase === 'switch_required'
                        ? () => void switchToSepolia()
                        : () => void connect()
                    }
                    type="button"
                  >
                    {connectButtonLabel}
                  </button>
                )}
                <p
                  className={`wallet-auth-message wallet-auth-message--${walletState.phase}`}
                  role={walletState.phase === 'error' ? 'alert' : 'status'}
                >
                  {walletState.message}
                </p>
                <Link className="register-button" to="/register-company">
                  Register a company
                </Link>
              </div>

              <div className="security-note">
                <Icon name="shield" size={16} />
                <p>Never share your private key or recovery phrase.</p>
              </div>

              <button
                aria-expanded={showWalletHelp}
                className="wallet-help"
                onClick={() => setShowWalletHelp((isVisible) => !isVisible)}
                type="button"
              >
                Why connect a wallet?
              </button>
              {showWalletHelp && (
                <p className="wallet-help-panel">
                  Your wallet proves address control. Your role is verified separately from your
                  Company Role Credential.
                </p>
              )}
            </div>
          </section>
        </section>

        <section
          className="understand-section"
          data-reveal-section
          id="understand"
          aria-labelledby="understand-title"
        >
          <div className="section-heading" data-reveal-direction="left">
            <p>Explore TraceChain</p>
            <h2 id="understand-title">Built for trusted handovers.</h2>
          </div>

          <div
            className="learning-tabs"
            data-reveal-direction="right"
            role="tablist"
            aria-label="Learn about TraceChain"
          >
            {(Object.keys(learningTabs) as LearningTab[]).map((tab) => (
              <button
                aria-controls="learning-panel"
                aria-selected={activeTab === tab}
                className={activeTab === tab ? 'active' : ''}
                id={`learning-tab-${tab}`}
                key={tab}
                onClick={() => setActiveTab(tab)}
                role="tab"
                type="button"
              >
                {learningTabs[tab].label}
              </button>
            ))}
          </div>

          <div className="learning-panel-reveal" data-reveal-direction="left">
            <div
              aria-labelledby={`learning-tab-${activeTab}`}
              className="learning-panel"
              id="learning-panel"
              key={activeTab}
              role="tabpanel"
            >
              <div className="learning-summary">
                <p>{activeLearningTab.label}</p>
                <h3>{activeLearningTab.title}</h3>
              </div>
              <div className="learning-grid">
                {activeLearningTab.items.map(([number, title, text]) => (
                  <article key={title}>
                    <span>{number}</span>
                    <h4>{title}</h4>
                    <p>{text}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          className="security-section"
          data-reveal-section
          id="security"
          aria-labelledby="security-title"
        >
          <div className="security-heading" data-reveal-direction="right">
            <p>Privacy by architecture</p>
            <h2 id="security-title">Proof where it matters. Privacy where it belongs.</h2>
          </div>

          <div className="security-features" data-reveal-direction="left">
            <article>
              <span>
                <Icon name="wallet" size={22} />
              </span>
              <div>
                <h3>Wallet controlled</h3>
                <p>Your private keys remain in MetaMask.</p>
              </div>
            </article>
            <article>
              <span>
                <Icon name="shield" size={22} />
              </span>
              <div>
                <h3>Credentials private</h3>
                <p>Sensitive identity data stays off-chain.</p>
              </div>
            </article>
            <article>
              <span>
                <Icon name="blocks" size={22} />
              </span>
              <div>
                <h3>Records auditable</h3>
                <p>Hashes and custody events remain verifiable.</p>
              </div>
            </article>
          </div>

          <div className="security-footer" data-reveal-direction="right">
            <span>
              <Icon name="check" size={14} /> No private keys stored
            </span>
            <span>
              <Icon name="check" size={14} /> Credentials verified before access
            </span>
            <a href="#sign-in">Connect securely →</a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <Brand />
        <p>Verifiable supply-chain traceability.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </div>
  );
}

export default LoginPage;
import { LoadingIndicator } from '../../components/ui/LoadingIndicator';
