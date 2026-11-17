import type { ReactNode } from 'react';
import { BellRing, Clock3 } from 'lucide-react';

import { CatalogueImage, CompanyAvatar } from '../../orders/CatalogueMedia';
import { Badge, Btn, EmptyState, InventorySummaryCard, SectionTitle, TechnicalDetails } from './ui';
import type { BadgeVariant } from './ui/Badge';

export interface OverviewMetric {
  icon: ReactNode;
  label: string;
  note?: string;
  value: string | number;
}

export interface OverviewRecord {
  actionLabel?: string;
  badge: { label: string; variant: BadgeVariant };
  companyLogoPath?: string;
  companyName?: string;
  description: string;
  imagePath?: string;
  itemCategory?: string;
  name: string;
  onAction?: () => void;
  reference?: string;
  technical?: Array<{ label: string; value: string }>;
}

export function StakeholderOverviewLayout({
  title,
  description,
  metrics,
  attention,
  recent,
  emptyAttention,
  emptyRecent,
}: {
  title: string;
  description: string;
  metrics: OverviewMetric[];
  attention: OverviewRecord[];
  recent: OverviewRecord[];
  emptyAttention: string;
  emptyRecent: string;
}) {
  return (
    <div className="stakeholder-overview">
      <SectionTitle title={title} sub={description} />
      <div className="stakeholder-overview__metrics" aria-label="Workspace summary">
        {metrics.slice(0, 4).map((metric) => (
          <InventorySummaryCard key={metric.label} {...metric} />
        ))}
      </div>
      <div className="stakeholder-overview__sections">
        <OverviewSection
          title="Needs your attention"
          icon={<BellRing size={19} />}
          records={attention}
          empty={emptyAttention}
        />
        <OverviewSection
          title="Recent activity"
          icon={<Clock3 size={19} />}
          records={recent}
          empty={emptyRecent}
        />
      </div>
    </div>
  );
}

function OverviewSection({
  title,
  icon,
  records,
  empty,
}: {
  title: string;
  icon: ReactNode;
  records: OverviewRecord[];
  empty: string;
}) {
  return (
    <section className="stakeholder-overview__section" aria-label={title}>
      <header>
        <span>{icon}</span>
        <h3>{title}</h3>
      </header>
      {!records.length ? (
        <EmptyState icon={icon} title={empty} sub="Nothing else requires action here right now." />
      ) : (
        <div className="stakeholder-overview__list">
          {records.slice(0, 5).map((record, index) => (
            <article
              className="stakeholder-overview__record"
              key={`${record.name}-${record.reference ?? index}`}
            >
              <div className="stakeholder-overview__image">
                <CatalogueImage
                  path={record.imagePath}
                  category={record.itemCategory}
                  alt={`${record.name} image`}
                />
              </div>
              <div className="stakeholder-overview__record-body">
                <div className="stakeholder-overview__record-heading">
                  <div>
                    <h4>{record.name}</h4>
                    {record.reference && <p>{record.reference}</p>}
                  </div>
                  <Badge {...record.badge} />
                </div>
                {record.companyName && (
                  <div className="workspace-company-cell">
                    <CompanyAvatar
                      name={record.companyName}
                      logoPath={record.companyLogoPath}
                      size="sm"
                    />
                    {record.companyName}
                  </div>
                )}
                <p>{record.description}</p>
                <div className="stakeholder-overview__record-actions">
                  {record.onAction && (
                    <Btn variant="outline" size="sm" onClick={record.onAction}>
                      {record.actionLabel ?? 'Review'}
                    </Btn>
                  )}
                </div>
                {record.technical?.length ? <TechnicalDetails fields={record.technical} /> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
