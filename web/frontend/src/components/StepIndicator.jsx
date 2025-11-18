export function StepIndicator({ current, total }) {
  return (
    <div className="step-indicator">
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <div
          key={step}
          className={`step-dot ${step === current ? 'active' : ''} ${step < current ? 'completed' : ''}`}
        />
      ))}
    </div>
  );
}

