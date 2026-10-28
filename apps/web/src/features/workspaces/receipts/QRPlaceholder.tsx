import { ScanLine } from 'lucide-react';
import { T, MONO } from '../shared/ui';

export function QRPlaceholder({ transferId, size = 140 }: { transferId: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        background: T.navyDark,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${T.border}`,
        flexShrink: 0,
      }}
    >
      <ScanLine size={size * 0.35} color={T.teal} />
      <div
        style={{
          fontFamily: MONO,
          fontSize: 8,
          color: T.teal,
          marginTop: 6,
          textAlign: 'center',
          maxWidth: size - 16,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {transferId}
      </div>
    </div>
  );
}
