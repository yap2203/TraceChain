import { T } from './tokens';

export function ClaimRow({
  label,
  value,
  sensitivity,
  included,
  onToggle,
}: {
  label: string;
  value?: string;
  sensitivity: 'public' | 'restricted' | 'confidential';
  included: boolean;
  onToggle?: () => void;
}) {
  const senColor = { public: T.green, restricted: T.amber, confidential: T.red }[sensitivity];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        background: included ? T.greenBg : T.redBg,
        borderRadius: 8,
        border: `1px solid ${included ? `color-mix(in srgb, ${T.green} 19%, transparent)` : `color-mix(in srgb, ${T.red} 13%, transparent)`}`,
        transition: 'all 0.2s',
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: T.navy }}>{label}</div>
        {value && <div style={{ fontSize: 12, color: T.text2, marginTop: 1 }}>{value}</div>}
      </div>
      <span
        style={{
          fontSize: 10,
          color: senColor,
          background: `color-mix(in srgb, ${senColor} 8%, transparent)`,
          padding: '2px 7px',
          borderRadius: 10,
          fontWeight: 600,
          textTransform: 'capitalize',
        }}
      >
        {sensitivity}
      </span>
      {onToggle && (
        <button
          onClick={onToggle}
          style={{
            width: 38,
            height: 20,
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
            background: included ? T.green : T.border2,
            position: 'relative',
            transition: 'background 0.2s',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 2,
              left: included ? 20 : 2,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: '#fff',
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          />
        </button>
      )}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: included ? T.green : T.red,
          minWidth: 44,
          textAlign: 'right',
        }}
      >
        {included ? 'Share' : 'Hide'}
      </div>
    </div>
  );
}
