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
//
// When the fence has NO language (a bare ``` block — common for slash-command /
// skill echoes), the header bar's only job (showing the language) is moot, so we
// drop the bar entirely rather than render an empty strip. Copy stays available
// as a hover button floated over the body's top-right corner.
export function CodeBlock({ code, lang }: CodeBlockProps) {
  const html = highlightCode(code, lang);
  const hasLang = !!(lang && lang.trim());
  return (
    <div class={`code-block-wrap${hasLang ? '' : ' code-block-wrap--nobar'}`}>
      {hasLang ? (
        <div class="code-block-bar">
          <span class="code-block-lang">{lang}</span>
          <CopyButton text={code} title="Copy code" class="code-block-copy-btn" />
        </div>
      ) : (
        <CopyButton text={code} title="Copy code" class="code-block-copy-btn code-block-copy-btn--float" />
      )}
      <pre class="code-block"><code class="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}
