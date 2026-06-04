import './TokenDisplay.less';

interface TokenDisplayProps {
  currentInputTokens: number;
  currentOutputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export function TokenDisplay({ currentInputTokens, currentOutputTokens, cacheCreationTokens, cacheReadTokens }: TokenDisplayProps) {
  const currentTotal = currentInputTokens + currentOutputTokens;
  if (currentTotal <= 0) return null;

  let text = `📊 Tokens: ${currentTotal.toLocaleString()}`;

  if (cacheCreationTokens || cacheReadTokens) {
    const cacheInfo: string[] = [];
    if (cacheCreationTokens) cacheInfo.push(`${cacheCreationTokens.toLocaleString()} cache created`);
    if (cacheReadTokens) cacheInfo.push(`${cacheReadTokens.toLocaleString()} cache read`);
    text += ` • ${cacheInfo.join(' • ')}`;
  }

  return (
    <div class="token-display">{text}</div>
  );
}
