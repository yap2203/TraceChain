interface BrandProps {
  compact?: boolean;
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <div className={`brand${compact ? ' brand--compact' : ''}`} aria-label="TraceChain">
      <span className="brand-mark">
        <img alt="" src="/tracechain-mark.svg" />
      </span>
      <span className="brand-copy">
        <strong>TraceChain</strong>
        <small>Supply Chain SSI</small>
      </span>
    </div>
  );
}
