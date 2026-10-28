import { Btn, Card, Badge, Table, TR, TD, SectionTitle } from '../../shared/ui';
import { BATCHES } from '../fixtures';

export function IngredientBatches({
  onNew,
  onDetail,
}: {
  onNew: () => void;
  onDetail: (id: string) => void;
}) {
  return (
    <div>
      <SectionTitle
        title="Ingredient Batches"
        sub="All registered ingredient batches and issued credentials"
        action={<Btn onClick={onNew}>Register Ingredient Batch</Btn>}
      />
      <Card padding="0">
        <Table
          headers={[
            'Batch ID',
            'Ingredient',
            'Origin',
            'Quantity',
            'Produced',
            'Expires',
            'Allergen',
            'Certifications',
            'Credential',
            '',
          ]}
        >
          {BATCHES.map((b) => (
            <TR key={b.id} onClick={() => onDetail(b.id)}>
              <TD mono muted>
                {b.id}
              </TD>
              <TD bold>{b.name}</TD>
              <TD muted>{b.origin}</TD>
              <TD>{b.qty}</TD>
              <TD muted>{b.produced}</TD>
              <TD muted>{b.expires}</TD>
              <TD>{b.allergen}</TD>
              <TD>{b.cert}</TD>
              <TD>
                <Badge label="Active" variant="active" />
              </TD>
              <TD>
                <Btn
                  onClick={(e) => {
                    e.stopPropagation();
                    onDetail(b.id);
                  }}
                  variant="outline"
                  size="xs"
                >
                  View →
                </Btn>
              </TD>
            </TR>
          ))}
        </Table>
      </Card>
    </div>
  );
}
