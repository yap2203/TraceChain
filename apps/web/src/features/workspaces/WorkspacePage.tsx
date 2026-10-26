import { useCallback, useMemo, useState } from 'react';

import { AppIcon } from '../../components/icons/AppIcon';
import { ApplicationLayout } from '../../components/layout/ApplicationLayout';
import { Button, Card, Modal, StatusBadge, Table, type TableColumn } from '../../components/ui';
import { workspacePages, workspaces, type WorkspaceKey } from './workspace-config';

interface WorkspacePageProps {
  page: string;
  workspace: WorkspaceKey;
}

interface ReadinessRecord {
  detail: string;
  id: string;
  item: string;
  status: 'Planned' | 'Ready';
}

const readinessRows: readonly ReadinessRecord[] = [
  { id: 'route', item: 'Frontend route', detail: 'Responsive application shell', status: 'Ready' },
  {
    id: 'workflow',
    item: 'Business workflow',
    detail: 'Reserved for a later phase',
    status: 'Planned',
  },
  {
    id: 'services',
    item: 'Live services',
    detail: 'No API or blockchain connection',
    status: 'Planned',
  },
];

export function WorkspacePage({ page, workspace }: WorkspacePageProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const workspaceDefinition = workspaces[workspace];
  const pageDefinition = workspacePages[`${workspace}:${page}`];
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const columns = useMemo<readonly TableColumn<ReadinessRecord>[]>(
    () => [
      {
        key: 'item',
        header: 'Area',
        render: (record) => <strong className="table-primary">{record.item}</strong>,
      },
      { key: 'detail', header: 'Current state', render: (record) => record.detail },
      {
        key: 'status',
        header: 'Status',
        render: (record) => (
          <StatusBadge tone={record.status === 'Ready' ? 'success' : 'warning'}>
            {record.status}
          </StatusBadge>
        ),
      },
    ],
    [],
  );

  if (!pageDefinition) return null;

  return (
    <ApplicationLayout
      actions={
        <Button
          leadingIcon={<AppIcon name="plus" size={16} />}
          onClick={() => setIsModalOpen(true)}
        >
          {pageDefinition.actionLabel}
        </Button>
      }
      description={pageDefinition.description}
      navigation={workspaceDefinition.navigation}
      organisation={workspaceDefinition.organisation}
      roleLabel={workspaceDefinition.roleLabel}
      title={pageDefinition.title}
    >
      <section className="metric-grid" aria-label="Workspace summary">
        <Card className="metric-card">
          <span className="metric-card__label">Workspace</span>
          <strong>{workspaceDefinition.roleLabel}</strong>
          <StatusBadge tone="success">Shell ready</StatusBadge>
        </Card>
        <Card className="metric-card">
          <span className="metric-card__label">Network</span>
          <strong>Sepolia</strong>
          <span className="metric-card__meta">Connection placeholder</span>
        </Card>
        <Card className="metric-card">
          <span className="metric-card__label">Credential</span>
          <strong>Not verified</strong>
          <span className="metric-card__meta">SSI integration pending</span>
        </Card>
      </section>

      <Card
        description="Phase 2 provides presentation and navigation only. Live records will replace these readiness rows later."
        title={`${pageDefinition.title} readiness`}
      >
        <Table
          caption={`${pageDefinition.title} implementation readiness`}
          columns={columns}
          getRowKey={(record) => record.id}
          rows={readinessRows}
        />
      </Card>

      <Modal
        footer={
          <Button onClick={closeModal} variant="secondary">
            Close
          </Button>
        }
        isOpen={isModalOpen}
        onClose={closeModal}
        title={pageDefinition.actionLabel}
      >
        <div className="placeholder-dialog">
          <span>
            <AppIcon name={pageDefinition.icon} size={24} />
          </span>
          <div>
            <h3>Interface placeholder</h3>
            <p>
              This action is intentionally inactive until its API, identity and blockchain workflow
              is designed in a later phase.
            </p>
          </div>
        </div>
      </Modal>
    </ApplicationLayout>
  );
}
