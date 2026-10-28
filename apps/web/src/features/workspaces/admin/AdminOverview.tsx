import { ClipboardList, BarChart3, BadgeCheck, Users } from 'lucide-react';
import { T, Btn, Card, StatCard, Alert } from '../shared/ui';
import { APPS } from './applications/fixtures';

export function AdminOverview({ onNav }: { onNav: (tab: string) => void }) {
  const ACTIVITIES = [
    {
      time: '09:14 AM',
      event: 'Credential issued to CocoaCraft Manufacturing Sdn. Bhd.',
      type: 'issued',
    },
    {
      time: '08:47 AM',
      event: 'Application APP-2026-0041 submitted by SweetLeaf Ingredients',
      type: 'application',
    },
    {
      time: '08:22 AM',
      event: 'Credential CRED-SUP-2026-002 suspended — pending review',
      type: 'suspended',
    },
    {
      time: 'Yesterday',
      event: 'Application APP-2026-0038 approved — GreenMart Retail',
      type: 'approved',
    },
    {
      time: 'Yesterday',
      event: 'Application APP-2026-0037 rejected — insufficient documents',
      type: 'rejected',
    },
  ];
  const typeColor: Record<string, string> = {
    issued: T.teal,
    application: T.amber,
    suspended: T.amber,
    approved: T.green,
    rejected: T.red,
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Expiry alert */}
      <Alert
        type="warning"
        message="1 credential is expiring within 30 days: CRED-SUP-2026-001 (ABC Ingredients Sdn. Bhd.) — expires 2027-05-01. Consider initiating renewal."
      />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Pending Applications"
          value="3"
          color={T.amber}
          icon={<ClipboardList size={22} />}
          delta="2 require urgent review"
        />
        <StatCard
          label="Active Credentials"
          value="4"
          color={T.green}
          icon={<BadgeCheck size={22} />}
          delta="All verified"
        />
        <StatCard
          label="Suspended"
          value="1"
          color={T.amber}
          icon={<Users size={22} />}
          delta="Review required"
        />
        <StatCard
          label="Revoked"
          value="0"
          color={T.grey}
          icon={<BarChart3 size={22} />}
          delta="None this month"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Pending applications */}
        <Card>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: T.navy }}>Pending Applications</div>
            <Btn onClick={() => onNav('applications')} variant="outline" size="sm">
              View All
            </Btn>
          </div>
          {APPS.filter((a) => a.status === 'pending').map((app) => (
            <div
              key={app.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: `1px solid ${T.border}`,
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{app.company}</div>
                <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>
                  {app.id} · {app.role} · {app.submitted}
                </div>
              </div>
              <Btn onClick={() => onNav('applications')} variant="outline" size="xs">
                Review
              </Btn>
            </div>
          ))}
        </Card>

        {/* Recent activity */}
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
            Recent Activity
          </div>
          {ACTIVITIES.map((a, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 12,
                padding: '10px 0',
                borderBottom: i < ACTIVITIES.length - 1 ? `1px solid ${T.border}` : 'none',
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: typeColor[a.type] ?? T.grey,
                  marginTop: 6,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: T.text }}>{a.event}</div>
                <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>{a.time}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Companies by role */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 16 }}>
          Companies by Role
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[
            { role: 'Suppliers', count: 2, color: T.green },
            { role: 'Manufacturers', count: 1, color: T.teal },
            { role: 'Distributors', count: 1, color: T.amber },
            { role: 'Retailers', count: 1, color: T.navy },
          ].map((item) => (
            <div
              key={item.role}
              style={{
                padding: '16px',
                background: T.surface2,
                borderRadius: 10,
                textAlign: 'center',
                border: `1px solid ${T.border}`,
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: item.color,
                  margin: '0 auto 10px',
                }}
              />
              <div style={{ fontSize: 26, fontWeight: 700, color: item.color }}>{item.count}</div>
              <div style={{ fontSize: 12, color: T.text2, marginTop: 4 }}>{item.role}</div>
            </div>
          ))}
        </div>
      </Card>


      {/* Quick actions
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn onClick={() => onNav('applications')}>Review Applications</Btn>
        <Btn onClick={() => onNav('credentials')} variant="secondary">
          Manage Credentials
        </Btn>
        <Btn onClick={() => onNav('audit')} variant="outline">
          Generate Audit Report
        </Btn>
      </div> */}
    </div>
  );
}
