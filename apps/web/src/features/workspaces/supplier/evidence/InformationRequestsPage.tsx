import { useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';

import {
  listEvidenceRequests,
  type ProductionEvidenceRequest,
} from '../../../production-flow/production-flow.api';
import { Badge, Btn, Card, EmptyState, SectionTitle, Table, TD, TR } from '../../shared/ui';
import { chainDate, shortChainId } from '../../shared/operational-format';

const statuses = [
  'Unknown',
  'Awaiting response',
  'Evidence received',
  'Accepted',
  'Declined',
  'Rejected',
  'Cancelled',
];

export function InformationRequests({
  onRespond,
}: {
  onRespond: (request: ProductionEvidenceRequest) => void;
}) {
  const [requests, setRequests] = useState<ProductionEvidenceRequest[]>([]);
  useEffect(() => {
    void listEvidenceRequests().then((result) => setRequests(result.requests));
  }, []);
  return (
    <div>
      <SectionTitle
        title="Information Requests"
        sub="Real EvidenceRegistry requests addressed to this Supplier wallet"
      />
      <Card padding="0">
        {requests.length === 0 ? (
          <EmptyState
            icon={<Inbox size={44} />}
            title="No information requests"
            sub="Manufacturer requests for your on-chain ingredient batches will appear here."
          />
        ) : (
          <Table headers={['Request', 'Manufacturer', 'Ingredient batch', 'Due', 'Status', '']}>
            {requests.map((request) => (
              <TR key={request.requestId}>
                <TD mono>{shortChainId(request.requestId)}</TD>
                <TD mono muted>
                  {shortChainId(request.requester)}
                </TD>
                <TD mono>{shortChainId(request.ingredientBatchId)}</TD>
                <TD muted>{chainDate(request.dueAt)}</TD>
                <TD>
                  <Badge
                    label={statuses[request.status] ?? 'Unknown'}
                    variant={request.status === 3 ? 'active' : 'pending'}
                  />
                </TD>
                <TD>
                  {request.status === 1 && (
                    <Btn size="xs" onClick={() => onRespond(request)}>
                      Respond
                    </Btn>
                  )}
                </TD>
              </TR>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
