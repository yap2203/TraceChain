import flags from 'react-phone-number-input/flags';
import type { Country } from 'react-phone-number-input';
import { ingredientCountryCodes } from '@tracechain/shared';
import { RegistrationCountrySelect } from './RegistrationCountrySelect';
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const options = ingredientCountryCodes
  .map((value) => ({ value: value as Country, label: names.of(value) ?? value }))
  .sort((a, b) => a.label.localeCompare(b.label));
function Flag({ country, label }: { country?: Country; label: string }) {
  const Icon = country ? flags[country] : undefined;
  return Icon ? (
    <span className="block w-6 h-4 [&>svg]:w-full [&>svg]:h-full">
      <Icon title={label} />
    </span>
  ) : (
    <span>—</span>
  );
}
export function CountryField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <span>
        {label}
        {required && <span className="text-ws-red"> *</span>}
      </span>
      <RegistrationCountrySelect
        variant="field"
        aria-label={label}
        value={(value || undefined) as Country | undefined}
        options={options}
        onChange={(country) => onChange(country ?? '')}
        iconComponent={Flag}
      />
    </div>
  );
}
