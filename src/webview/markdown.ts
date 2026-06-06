import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js/lib/core';

import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import swift from 'highlight.js/lib/languages/swift';
import diff from 'highlight.js/lib/languages/diff';
import shell from 'highlight.js/lib/languages/shell';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('less', css);
hljs.registerLanguage('scss', css);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('tsx', typescript);

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    }
  })
);

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function parseSimpleMarkdown(markdown: string): string {
  const result = marked.parse(markdown);
  if (typeof result === 'string') return result;
  return '';
}

// Highlight a raw code string to HTML using the same hljs config the markdown
// pipeline uses. Used by the CodeBlock component (which renders fences as real
// components rather than letting marked emit <pre> inline).
export function highlightCode(code: string, lang?: string): string {
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(code, { language: lang }).value;
  }
  return hljs.highlightAuto(code).value;
}

// A segment of a chat message: either prose (pre-rendered HTML, safe to inject)
// or a fenced code block (raw code + language, rendered by the CodeBlock
// component so it can carry its own copy button as a real child).
export type MarkdownSegment =
  | { type: 'html'; html: string }
  | { type: 'code'; code: string; lang: string };

// Split a markdown string into prose runs and top-level fenced code blocks.
// Prose runs go through the normal `marked` pipeline (unchanged rendering);
// code fences become structured tokens the caller renders as <CodeBlock>.
// Indented (4-space) code blocks are left to the prose path — only ``` / ~~~
// fenced blocks are extracted (that's what assistants emit).
export function segmentMarkdown(markdown: string): MarkdownSegment[] {
  const tokens = marked.lexer(markdown);
  const segments: MarkdownSegment[] = [];
  let proseBuffer: string[] = [];

  const flushProse = () => {
    if (proseBuffer.length === 0) return;
    const html = parseSimpleMarkdown(proseBuffer.join('\n\n'));
    if (html) segments.push({ type: 'html', html });
    proseBuffer = [];
  };

  for (const tok of tokens) {
    // marked's lexer tags fenced blocks as 'code'; indented code also lands here
    // but we only special-case fenced (it carries `lang`). Treat both as code —
    // a copy button on an indented block is still useful.
    if (tok.type === 'code') {
      flushProse();
      segments.push({ type: 'code', code: (tok as any).text ?? '', lang: ((tok as any).lang ?? '').trim() });
    } else {
      // Preserve the original source so the prose run re-renders identically.
      proseBuffer.push((tok as any).raw ?? '');
    }
  }
  flushProse();
  return segments;
}
