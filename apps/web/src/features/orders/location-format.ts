export function formatLocationLabel(
  location: { label?: string; name?: string; address?: string; location?: string } | undefined,
  fallback = 'Registered location',
) {
  const name = location?.label ?? location?.name ?? fallback;
  return location?.address ? name + ' - ' + location.address.replace(/\s+/g, ' ').trim() : name;
}
