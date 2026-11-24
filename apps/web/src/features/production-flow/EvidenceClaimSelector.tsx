import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EvidenceClaimDefinition } from '@tracechain/shared';
import { Btn, Input } from '../workspaces/shared/ui';

export type ClaimRequirement = 'required' | 'optional';
export type ClaimClassification = ClaimRequirement | 'unselected';

export function classifyEvidenceClaims(
  ids: readonly string[],
  required: readonly string[],
  optional: readonly string[],
): Record<string, ClaimClassification> {
  const requiredSet = new Set(required);
  const optionalSet = new Set(optional);
  return Object.fromEntries(
    ids.map((id) => [
      id,
      requiredSet.has(id) ? 'required' : optionalSet.has(id) ? 'optional' : 'unselected',
    ]),
  );
}

export function evidenceClaimLists(fields: Record<string, ClaimClassification>) {
  const required: string[] = [];
  const optional: string[] = [];
  for (const [id, classification] of Object.entries(fields)) {
    if (classification === 'required') required.push(id);
    if (classification === 'optional') optional.push(id);
  }
  return { required, optional };
}

export function EvidenceClaimSelector({
  catalogue,
  required,
  optional,
  onChange,
}: {
  catalogue: readonly EvidenceClaimDefinition[];
  required: string[];
  optional: string[];
  onChange: (required: string[], optional: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const visible = useMemo(
    () =>
      catalogue.filter(
        (claim) =>
          !query || `${claim.label} ${claim.group}`.toLocaleLowerCase().includes(query),
      ),
    [catalogue, query],
  );
  const groups = [...new Set(visible.map((claim) => claim.group))];
  const fields = useMemo(
    () => classifyEvidenceClaims(catalogue.map((claim) => claim.id), required, optional),
    [catalogue, required, optional],
  );
  const selected = new Set(
    Object.entries(fields)
      .filter(([, classification]) => classification !== 'unselected')
      .map(([id]) => id),
  );
  const emit = (next: Record<string, ClaimClassification>) => {
    const lists = evidenceClaimLists(next);
    onChange(lists.required, lists.optional);
  };
  const setClaim = (id: string, include: boolean) => {
    emit({ ...fields, [id]: include ? 'optional' : 'unselected' });
  };
  const setRequirement = (id: string, requirement: ClaimRequirement) =>
    emit({ ...fields, [id]: requirement });
  return (
    <fieldset className='evidence-claim-selector'>
      <legend>Business fields to request</legend>
      <div className='evidence-claim-selector__tools'>
        <Input
          label='Search fields'
          type='search'
          icon={<Search size={16} />}
          value={search}
          onChange={setSearch}
          placeholder='Search available credential fields'
        />
        <div className='action-row'>
          <Btn
            size='xs'
            variant='outline'
            onClick={() =>
              emit(
                Object.fromEntries(
                  Object.entries(fields).map(([id, classification]) => [
                    id,
                    classification === 'unselected' ? 'optional' : classification,
                  ]),
                ),
              )
            }
          >
            Select all
          </Btn>
          <Btn
            size='xs'
            variant='outline'
            onClick={() =>
              emit(Object.fromEntries(Object.keys(fields).map((id) => [id, 'unselected'])))
            }
          >
            Clear all
          </Btn>
        </div>
      </div>
      <p className='evidence-claim-selector__count'>{selected.size} field{selected.size === 1 ? '' : 's'} selected</p>
      {groups.map((group) => (
        <details key={group} open className='evidence-claim-selector__group'>
          <summary>{group}</summary>
          <div className='evidence-claim-selector__grid'>
            {visible.filter((claim) => claim.group === group).map((claim) => {
              const checked = selected.has(claim.id);
              return (
                <div className='evidence-claim-selector__claim' key={claim.id}>
                  <label>
                    <input
                      type='checkbox'
                      checked={checked}
                      onChange={(event) => setClaim(claim.id, event.target.checked)}
                    />
                    <span>{claim.label}</span>
                  </label>
                  {checked && (
                    <div
                      className='evidence-claim-selector__requirement'
                      role='group'
                      aria-label={`${claim.label} requirement`}
                    >
                      <button
                        type='button'
                        aria-pressed={fields[claim.id] === 'optional'}
                        onClick={() => setRequirement(claim.id, 'optional')}
                      >
                        Optional
                      </button>
                      <button
                        type='button'
                        aria-pressed={fields[claim.id] === 'required'}
                        onClick={() => setRequirement(claim.id, 'required')}
                      >
                        Required
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      ))}
      {!visible.length && <p>No credential fields match this search.</p>}
    </fieldset>
  );
}
