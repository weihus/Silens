interface IcebreakerProps {
  text: string;
  evaporating: boolean;
}

export function Icebreaker({ text, evaporating }: IcebreakerProps) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-0 w-full max-w-[720px] px-[40px]"
      style={{
        opacity: evaporating ? 0 : 0.18,
        transform: evaporating ? 'translate(-50%, -9px)' : 'translate(-50%, 0px)',
        filter: evaporating ? 'blur(4px)' : 'blur(0px)',
        transition: 'opacity 700ms cubic-bezier(0.4, 0, 0.2, 1), transform 700ms cubic-bezier(0.4, 0, 0.2, 1), filter 700ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      aria-hidden="true"
    >
      <div
        className="w-full"
        style={{
          fontSize: '18px',
          lineHeight: '1.8',
          letterSpacing: '0.05em',
          color: 'var(--theme-text)',
        }}
      >
        {text}
      </div>
    </div>
  );
}
