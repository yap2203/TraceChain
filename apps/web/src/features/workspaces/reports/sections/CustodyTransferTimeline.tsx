import { T, Card, CustodyTimeline } from '../../shared/ui';

export function CustodyTransferTimeline() {
  return (
    <>
      {/* 5. Custody Transfer Timeline */}
      <Card>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.navy, marginBottom: 14 }}>
          5. Custody Transfer Timeline
        </div>
        <CustodyTimeline
          steps={[
            {
              org: 'CocoaCraft Manufacturing Sdn. Bhd.',
              action: 'Product batch created · Ingredient credentials linked',
              date: '1 Aug 2026, 09:14 AM',
              qty: '500 units',
              verified: true,
            },
            {
              org: 'Swift Distribution Sdn. Bhd.',
              action: 'Accepted product custody',
              date: '9 Aug 2026, 11:30 AM',
              qty: '500 received · 10 damaged · 490 available',
              verified: true,
            },
            {
              org: 'Swift Distribution Sdn. Bhd.',
              action: 'Transferred to retailer',
              date: '9 Aug 2026, 02:15 PM',
              qty: '490 units dispatched',
              verified: true,
            },
            {
              org: 'FreshMart Retail Sdn. Bhd.',
              action: 'Final receipt · End of supply chain',
              date: '9 Aug 2026, 04:00 PM',
              qty: '490 units accepted',
              verified: true,
            },
          ]}
        />
      </Card>
    </>
  );
}
