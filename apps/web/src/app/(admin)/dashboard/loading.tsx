export default function DashboardLoading() {
  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <div className="skeleton" style={{ width: 120, height: 28, borderRadius: 6 }} />
          <div className="skeleton" style={{ width: 160, height: 16, borderRadius: 4, marginTop: 6 }} />
        </div>
        <div className="skeleton" style={{ width: 110, height: 36, borderRadius: 8 }} />
      </div>

      <div className="kpi-grid">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kpi-card">
            <div className="skeleton" style={{ width: 90, height: 12, borderRadius: 3, marginBottom: 8 }} />
            <div className="skeleton" style={{ width: 48, height: 32, borderRadius: 4 }} />
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, marginTop: 16 }}>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="data-panel">
            <div className="data-panel-header">
              <div className="skeleton" style={{ width: 140, height: 14, borderRadius: 3 }} />
            </div>
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="data-panel-row">
                <div className="skeleton" style={{ width: '60%', height: 13, borderRadius: 3 }} />
                <div className="skeleton" style={{ width: 40, height: 13, borderRadius: 3 }} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="data-panel" style={{ marginBottom: 16 }}>
        <div className="data-panel-header">
          <div className="skeleton" style={{ width: 200, height: 14, borderRadius: 3 }} />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="data-panel-row">
            <div>
              <div className="skeleton" style={{ width: 120, height: 13, borderRadius: 3, marginBottom: 4 }} />
              <div className="skeleton" style={{ width: 80, height: 10, borderRadius: 3 }} />
            </div>
            <div className="skeleton" style={{ width: 70, height: 22, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    </div>
  )
}
