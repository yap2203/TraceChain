import { useState } from 'react';
import { Search, Clock, CheckCircle2, AlertCircle, FileCheck } from 'lucide-react';
import { T, UI, Btn, StatCard } from '../../shared/ui';
import { type EvidenceRequest, type AcceptedEvidence } from './types';
import { INIT_REQUESTS, INIT_ACCEPTED } from './fixtures';
import { RequestWizard } from './RequestWizard';
import { RequestDetail } from './RequestDetail';
import { ReviewEvidence } from './ReviewEvidence';
import { RequestsTable } from './RequestsTable';
import { AcceptedEvidenceTable } from './AcceptedEvidenceTable';
export function IngredientEvidence({ onNav }: { onNav: (t: string) => void }) {
  type View = 'list' | 'wizard' | 'detail' | 'review';
  const [view, setView] = useState<View>('list');
  const [tab, setTab] = useState<'requests' | 'accepted'>('requests');
  const [search, setSearch] = useState('');
  const [requests, setRequests] = useState<EvidenceRequest[]>(INIT_REQUESTS);
  const [accepted, setAccepted] = useState<AcceptedEvidence[]>(INIT_ACCEPTED);
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeReq = requests.find((r) => r.id === activeId) ?? null;

  const updateReq = (id: string, patch: Partial<EvidenceRequest>) =>
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const counts = {
    awaiting: requests.filter((r) => r.status === 'awaiting').length,
    received: requests.filter((r) => r.status === 'received').length,
    accepted: accepted.length,
    attention: requests.filter(
      (r) => (r.status === 'awaiting' && r.overdue) || r.status === 'declined',
    ).length,
  };

  const filteredRequests = requests.filter((r) => {
    const q = search.toLowerCase();
    return (
      !q ||
      r.id.toLowerCase().includes(q) ||
      r.supplier.toLowerCase().includes(q) ||
      r.ingredient.toLowerCase().includes(q) ||
      r.batch.toLowerCase().includes(q)
    );
  });

  const filteredAccepted = accepted.filter((a) => {
    const q = search.toLowerCase();
    return (
      !q ||
      a.ingredient.toLowerCase().includes(q) ||
      a.batch.toLowerCase().includes(q) ||
      a.supplier.toLowerCase().includes(q) ||
      a.credentialId.toLowerCase().includes(q)
    );
  });

  // ── Wizard ─────────────────────────────────────────────────────────────────
  if (view === 'wizard') {
    return (
      <RequestWizard
        onBack={() => setView('list')}
        onSent={(newReq) => {
          setRequests((prev) => [newReq, ...prev]);
          setView('list');
        }}
      />
    );
  }

  // ── Detail ─────────────────────────────────────────────────────────────────
  if (view === 'detail' && activeReq) {
    return (
      <RequestDetail
        req={activeReq}
        onBack={() => setView('list')}
        onReview={() => setView('review')}
        onFollowUp={() => {
          setView('wizard');
        }}
        onCancel={(reason) => {
          updateReq(activeReq.id, {
            status: 'cancelled',
            timeline: [
              ...activeReq.timeline,
              {
                date:
                  '2026-09-07 ' +
                  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                event: `Request cancelled. Reason: ${reason}`,
                type: 'cancelled',
              },
            ],
          });
          setView('list');
        }}
      />
    );
  }

  // ── Review ─────────────────────────────────────────────────────────────────
  if (view === 'review' && activeReq) {
    return (
      <ReviewEvidence
        req={activeReq}
        onBack={() => setView('detail')}
        onAccept={(notes) => {
          const acc: AcceptedEvidence = {
            reqId: activeReq.id,
            ingredient: activeReq.ingredient,
            batch: activeReq.batch,
            supplier: activeReq.supplier,
            credentialId: activeReq.credentialId ?? 'IC-' + activeReq.batch,
            acceptedDate: '2026-09-07',
            credentialExpiry: activeReq.credentialExpiry ?? '2027-09-07',
            credentialStatus: 'active',
            availability: 'available',
          };
          setAccepted((prev) => [acc, ...prev]);
          updateReq(activeReq.id, {
            status: 'accepted',
            acceptedDate: '2026-09-07',
            reviewNotes: notes,
            timeline: [
              ...activeReq.timeline,
              {
                date:
                  '2026-09-07 ' +
                  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                event: 'Evidence accepted and added to Accepted Evidence.',
                type: 'accepted',
              },
            ],
          });
          setView('list');
          setTab('accepted');
        }}
        onReject={(reason, notes) => {
          updateReq(activeReq.id, {
            status: 'rejected',
            declineReason: reason,
            timeline: [
              ...activeReq.timeline,
              {
                date:
                  '2026-09-07 ' +
                  new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                event: `Evidence rejected by manufacturer. ${notes ? 'Notes: ' + notes : ''}`,
                type: 'rejected',
              },
            ],
          });
          setView('list');
        }}
      />
    );
  }

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: T.navy, margin: '0 0 4px' }}>
            Ingredient Evidence
          </h1>
          <p style={{ fontSize: 13, color: T.text2, margin: 0 }}>
            Request, review and verify supplier evidence before using ingredients in your products.
          </p>
        </div>
        <Btn onClick={() => setView('wizard')}>Request Ingredient Evidence</Btn>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        <StatCard
          label="Awaiting Supplier Response"
          value={counts.awaiting}
          color={T.amber}
          icon={<Clock size={22} />}
        />
        <StatCard
          label="Evidence Ready for Review"
          value={counts.received}
          color={T.teal}
          icon={<FileCheck size={22} />}
        />
        <StatCard
          label="Accepted Evidence"
          value={counts.accepted}
          color={T.green}
          icon={<CheckCircle2 size={22} />}
        />
        <StatCard
          label="Requiring Attention"
          value={counts.attention}
          color={T.red}
          icon={<AlertCircle size={22} />}
        />
      </div>

      {/* Tabs + search */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div
          style={{ display: 'flex', gap: 2, background: T.surface2, borderRadius: 8, padding: 3 }}
        >
          {(['requests', 'accepted'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 18px',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontFamily: UI,
                fontSize: 13,
                fontWeight: tab === t ? 600 : 400,
                background: tab === t ? T.surface : 'transparent',
                color: tab === t ? T.navy : T.text2,
                boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {t === 'requests' ? 'Requests' : 'Accepted Evidence'}
            </button>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 12px',
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            width: 280,
          }}
        >
          <Search size={14} color={T.text3} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier, ingredient, batch, ID…"
            style={{
              border: 'none',
              background: 'none',
              color: T.text,
              fontSize: 13,
              outline: 'none',
              flex: 1,
              fontFamily: UI,
            }}
          />
        </div>
      </div>

      <RequestsTable
        tab={tab}
        filteredRequests={filteredRequests}
        setView={setView}
        setActiveId={setActiveId}
      />
      <AcceptedEvidenceTable tab={tab} filteredAccepted={filteredAccepted} onNav={onNav} />
    </div>
  );
}
