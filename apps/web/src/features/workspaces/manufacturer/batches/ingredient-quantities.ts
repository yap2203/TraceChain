const mass: Record<string, bigint> = { mg: 1n, g: 1000n, kg: 1000000n };
const volume: Record<string, bigint> = {
  ml: 1n,
  l: 1000n,
  litre: 1000n,
  liter: 1000n,
  litres: 1000n,
  liters: 1000n,
};
function family(unit: string) {
  return Object.hasOwn(mass, unit.toLowerCase())
    ? mass
    : Object.hasOwn(volume, unit.toLowerCase())
      ? volume
      : undefined;
}

export function ingredientUnitOptions(registeredUnit: string) {
  const group = family(registeredUnit);
  const alternatives = group === mass ? ['kg', 'g', 'mg'] : group === volume ? ['litre', 'ml'] : [];
  return [...new Set([registeredUnit, ...alternatives])].map((value) => ({ value, label: value }));
}

/** Convert display amounts exactly; contract quantities stay whole registered units. */
export function registeredIngredientQuantity(
  amount: string,
  selectedUnit: string,
  registeredUnit: string,
): { quantity?: string; error?: string } {
  if (!/^(0|[1-9]\d{0,38})(\.\d{1,6})?$/.test(amount))
    return { error: 'Enter a positive amount with up to six decimal places.' };
  const group = family(registeredUnit);
  const sourceFactor =
    selectedUnit === registeredUnit
      ? 1n
      : group && Object.hasOwn(group, selectedUnit.toLowerCase())
        ? group[selectedUnit.toLowerCase()]
        : undefined;
  const targetFactor = selectedUnit === registeredUnit ? 1n : group?.[registeredUnit.toLowerCase()];
  if (!sourceFactor || !targetFactor || family(selectedUnit) !== group) {
    if (selectedUnit !== registeredUnit)
      return { error: 'Choose a unit compatible with this ingredient.' };
  }
  const [whole, fraction = ''] = amount.split('.');
  const numerator = BigInt(whole + fraction) * (sourceFactor ?? 1n);
  const denominator = 10n ** BigInt(fraction.length) * (targetFactor ?? 1n);
  if (numerator <= 0n || numerator % denominator !== 0n)
    return {
      error: `This batch is recorded in whole ${registeredUnit}; enter an exact positive whole-unit equivalent.`,
    };
  const quantity = (numerator / denominator).toString();
  if (quantity.length > 39) return { error: 'The converted quantity is too large.' };
  return { quantity };
}
