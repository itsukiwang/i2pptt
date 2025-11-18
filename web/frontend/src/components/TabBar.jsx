export function TabBar({ tabs, current, maxReached, onChange }) {
  return (
    <nav className="tab-bar" role="tablist">
      {tabs.map((tab) => {
        const isActive = tab.id === current;
        const isEnabled = tab.id <= maxReached;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? 'tab active' : 'tab'}
            disabled={!isEnabled}
            onClick={() => isEnabled && onChange(tab.id)}
          >
            <span className="tab-index">{tab.id}</span>
            <span className="tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

