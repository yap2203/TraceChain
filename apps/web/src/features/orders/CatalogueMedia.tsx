import { Building2, Image as ImageIcon, Leaf, Package } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CatalogueMediaError, fetchCatalogueMedia } from './orders.api';

type MediaState = 'idle' | 'loading' | 'missing' | 'denied' | 'failed' | 'ready';

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
  const [state, setState] = useState<MediaState>('idle');
  useEffect(() => {
    let active = true;
    let url = '';
    setState(path ? 'loading' : 'missing');
    setSource('');
    if (path)
      void fetchCatalogueMedia(path)
        .then((blob) => {
          if (!active) return;
          url = URL.createObjectURL(blob);
          setSource(url);
          setState('ready');
        })
        .catch((error) => {
          if (!active) return;
          setState(
            error instanceof CatalogueMediaError
              ? error.reason === 'denied'
                ? 'denied'
                : error.reason === 'missing'
                  ? 'missing'
                  : 'failed'
              : 'failed',
          );
        });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (source && state === 'ready')
    return (
      <img
        src={source}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setState('failed')}
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
      aria-label={
        state === 'denied'
          ? `${category || 'Ingredient'} image is not available to this account`
          : state === 'failed'
            ? `${category || 'Ingredient'} image could not be loaded`
            : `${category || 'Ingredient'} image placeholder`
      }
      data-media-state={state}
    >
      <Icon aria-hidden="true" size={large ? 52 : 34} />
      <span>{category || 'Ingredient'}</span>
      <small>
        {state === 'denied'
          ? 'Image access unavailable'
          : state === 'failed'
            ? 'Image could not be loaded'
            : state === 'loading'
              ? 'Loading image'
              : 'No image provided'}
      </small>
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
        <img
          src={source}
          alt={`${name} company logo`}
          loading="lazy"
          decoding="async"
          onError={() => setSource('')}
        />
      ) : (
        <>
          <Building2 aria-hidden="true" size={size === 'sm' ? 12 : 14} />
          <span aria-label={`${name} initials`}>{initials}</span>
        </>
      )}
    </span>
  );
}
