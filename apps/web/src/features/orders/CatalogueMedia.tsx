import { Building2, Image as ImageIcon, Leaf, Package } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fetchCatalogueMedia } from './orders.api';

export function CatalogueImage({
  path,
  alt,
  category,
  large = false,
}: {
  path?: string;
  alt: string;
  category?: string;
  large?: boolean;
}) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let url = '';
    setFailed(false);
    setSource('');
    if (path)
      void fetchCatalogueMedia(path)
        .then((blob) => {
          if (!active) return;
          url = URL.createObjectURL(blob);
          setSource(url);
        })
        .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (source && !failed)
    return (
      <img
        src={source}
        alt={alt}
        onError={() => setFailed(true)}
        className={`catalogue-image ${large ? 'catalogue-image--large' : ''}`}
      />
    );
  const text = category?.toLowerCase() ?? '';
  const Icon =
    text.includes('plant') || text.includes('produce') ? Leaf : text ? Package : ImageIcon;
  return (
    <div
      className={`catalogue-image catalogue-image--fallback ${large ? 'catalogue-image--large' : ''}`}
      role="img"
      aria-label={`${category || 'Ingredient'} image placeholder`}
    >
      <Icon aria-hidden="true" size={large ? 52 : 34} />
      <span>{category || 'Ingredient'}</span>
    </div>
  );
}

export function CompanyAvatar({
  name,
  logoPath,
  size = 'md',
}: {
  name: string;
  logoPath?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [source, setSource] = useState('');
  const initials = useMemo(
    () =>
      name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'TC',
    [name],
  );
  useEffect(() => {
    let active = true;
    let url = '';
    setSource('');
    if (logoPath)
      void fetchCatalogueMedia(logoPath)
        .then((blob) => {
          if (!active) return;
          url = URL.createObjectURL(blob);
          setSource(url);
        })
        .catch(() => undefined);
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [logoPath]);
  return (
    <span className={`company-avatar company-avatar--${size}`}>
      {source ? (
        <img src={source} alt={`${name} company logo`} />
      ) : (
        <>
          <Building2 aria-hidden="true" size={size === 'sm' ? 12 : 14} />
          <span aria-label={`${name} initials`}>{initials}</span>
        </>
      )}
    </span>
  );
}
