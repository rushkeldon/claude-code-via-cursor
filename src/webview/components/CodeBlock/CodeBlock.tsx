import './CodeBlock.less';
import { CopyButton } from '../CopyButton/CopyButton';
import { highlightCode } from '../../markdown';

interface CodeBlockProps {
  // Raw, undecorated code (what the copy button puts on the clipboard).
  code: string;
  // Fence language (e.g. 'ts', 'bash'); '' when the fence had no language.
  lang?: string;
}

// A fenced code block in chat history: a header row carrying the language label
// and its own CopyButton (top-right), over the syntax-highlighted body. The copy
// reads the RAW `code` prop — never the highlighted HTML — so no markup leaks in.
export function CodeBlock({ code, lang }: CodeBlockProps) {
  const html = highlightCode(code, lang);
  return (
    <div class="code-block-wrap">
      <div class="code-block-bar">
        <span class="code-block-lang">{lang || ''}</span>
        <CopyButton text={code} title="Copy code" class="code-block-copy-btn" />
      </div>
      <pre class="code-block"><code class="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}
