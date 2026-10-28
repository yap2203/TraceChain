import { Inbox } from 'lucide-react';
import { Btn, Card, Badge, Table, TR, TD, SectionTitle, EmptyState } from '../../shared/ui';
import { REQUESTS } from '../fixtures';

export function InformationRequests({
  onRespond,
}: {
  onRespond: (req: (typeof REQUESTS)[0]) => void;
}) {
  return (
    <div>
      <SectionTitle title="Information Requests" sub="Evidence requests from manufacturers" />
      <Card padding="0">
        {REQUESTS.length === 0 ? (
          <EmptyState
            icon={<Inbox size={44} />}
            title="No information requests"
            sub="When a manufacturer requests ingredient evidence, it will appear here."
          />
        ) : (
          <Table
            headers={[
              'Request ID',
              'From',
              'Ingredient',
              'Claims Requested',
              'Due Date',
              'Status',
              '',
            ]}
          >
            {REQUESTS.map((r) => (
              <TR key={r.id}>
                <TD mono muted>
                  {r.id}
                </TD>
                <TD bold>{r.from.split(' Sdn')[0]}</TD>
                <TD>{r.ingredient}</TD>
                <TD muted>{r.claims.length} claims</TD>
                <TD muted>{r.due}</TD>
                <TD>
                  <Badge label={r.status} variant={r.status} />
                </TD>
                <TD>
                  {r.status === 'pending' ? (
                    <Btn onClick={() => onRespond(r)} size="xs">
                      Respond
                    </Btn>
                  ) : (
                    <Btn variant="outline" size="xs">
                      View
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
