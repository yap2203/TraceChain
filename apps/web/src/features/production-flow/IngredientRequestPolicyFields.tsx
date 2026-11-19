import {
  INGREDIENT_REQUEST_TEMPLATES,
  type IngredientRequestPolicy,
  type IngredientRequestTemplate,
} from '@tracechain/shared';
import { SelectField, Input } from '../workspaces/shared/ui';
export function IngredientRequestPolicyFields({
  policy,
  onChange,
  onRequirements,
}: {
  policy: IngredientRequestPolicy;
  onChange: (value: IngredientRequestPolicy) => void;
  onRequirements: (claims: readonly string[]) => void;
}) {
  return (
    <div className="grid min-w-0 gap-4">
      <SelectField
        label="Request template"
        value={policy.template ?? 'custom'}
        onChange={(value) => {
          const template = value as IngredientRequestTemplate;
          onChange({ ...policy, policyVersion: 2, template });
          onRequirements(INGREDIENT_REQUEST_TEMPLATES[template].required);
        }}
        options={Object.entries(INGREDIENT_REQUEST_TEMPLATES)
          .filter(([value]) => value !== 'quality')
          .map(([value, entry]) => ({
            value,
            label: entry.label,
          }))}
      />
      <p className="text-sm">
        Always included: ingredient name, TraceChain batch ID, available Supplier batch reference,
        Supplier identity/wallet, issuer, credential and holder binding. Ingredient expiry is
        separate from credential expiry.
      </p>
      <details open={policy.template === 'certification'}>
        <summary>Certification type and scope constraints (optional)</summary>
        <div className="workspace-form-grid">
          <Input
            label="Certification type / name (optional: any matching entry)"
            value={policy.certificationRequirement?.name ?? ''}
            onChange={(name) =>
              onChange({
                ...policy,
                certificationRequirement: {
                  ...policy.certificationRequirement,
                  name: name || undefined,
                },
              })
            }
            maxLength={120}
          />
          <SelectField
            label="Certification scope"
            value={policy.certificationRequirement?.scope ?? ''}
            onChange={(scope) =>
              onChange({
                ...policy,
                certificationRequirement: {
                  ...policy.certificationRequirement,
                  scope: (scope || undefined) as
                    'Company' | 'Facility' | 'Ingredient' | 'This batch' | undefined,
                },
              })
            }
            options={['', 'Company', 'Facility', 'Ingredient', 'This batch'].map((value) => ({
              value,
              label: value || 'Any supported scope',
            }))}
          />
          <Input
            label="Required covered reference (optional)"
            value={policy.certificationRequirement?.scopeReference ?? ''}
            onChange={(scopeReference) =>
              onChange({
                ...policy,
                certificationRequirement: {
                  ...policy.certificationRequirement,
                  scopeReference: scopeReference || undefined,
                },
              })
            }
            maxLength={160}
          />
        </div>
      </details>
      {policy.template === 'food' && (
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={!!policy.allowUnknownAllergens}
            onChange={(event) =>
              onChange({ ...policy, allowUnknownAllergens: event.target.checked })
            }
          />
          Allow explicitly declared Unknown allergen status. Unknown is rejected by default.
        </label>
      )}
    </div>
  );
}
