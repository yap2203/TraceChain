import { COMPANY_ALWAYS_CLAIMS, companyDisclosureGroup } from '@tracechain/shared';
import { SelectField } from '../workspaces/shared/ui';
export function CompanyRequestFields({
  required,
  optional,
  onChange,
}: {
  required: string[];
  optional: string[];
  onChange: (required: string[], optional: string[]) => void;
}) {
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-lg border border-solid border-ws-border p-4">
      <legend>Company identity disclosure</legend>
      <p>
        Always included: company name, approved role, wallet and subject DID, issuer, credential
        reference, holder binding and validity. Registration number and country are shared together.
      </p>
      {[
        ['companyRegistrationNumber', 'Registration number and registration country'],
        ['companyId', 'Internal company ID'],
      ].map(([key, label]) => (
        <SelectField
          key={key}
          label={label}
          value={required.includes(key) ? 'required' : optional.includes(key) ? 'optional' : 'none'}
          options={[
            { value: 'none', label: 'Not requested' },
            { value: 'optional', label: 'Optional' },
            { value: 'required', label: 'Required' },
          ]}
          onChange={(choice) => {
            const group = companyDisclosureGroup([key]);
            onChange(
              [
                ...new Set([
                  ...COMPANY_ALWAYS_CLAIMS,
                  ...required.filter((k) => !group.includes(k)),
                  ...(choice === 'required' ? group : []),
                ]),
              ],
              [
                ...optional.filter((k) => !group.includes(k)),
                ...(choice === 'optional' ? group : []),
              ],
            );
          }}
        />
      ))}
    </fieldset>
  );
}
