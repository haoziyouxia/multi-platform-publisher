interface PlatformSelectorProps {
  selected: string[];
  onChange: (platforms: string[]) => void;
}

const PLATFORMS = [
  { id: 'xiaohongshu', name: '小红书', icon: '🔴' },
  { id: 'wechat', name: '公众号', icon: '🟢' },
  { id: 'toutiao', name: '头条号', icon: '🟠' },
];

const PlatformSelector = ({ selected, onChange }: PlatformSelectorProps) => {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(p => p !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>目标平台</div>
      <div style={{ display: 'flex', gap: 12 }}>
        {PLATFORMS.map(p => (
          <label
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              border: `2px solid ${selected.includes(p.id) ? 'var(--primary)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              background: selected.includes(p.id) ? '#eef2ff' : 'var(--card-bg)',
            }}
          >
            <input
              type="checkbox"
              checked={selected.includes(p.id)}
              onChange={() => toggle(p.id)}
              style={{ display: 'none' }}
            />
            <span>{p.icon}</span>
            <span>{p.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default PlatformSelector;
