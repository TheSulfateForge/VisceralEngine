import DOMPurify from 'dompurify';
import { marked } from 'marked';

export const safeMarkdown = (markdown: string): string => {
  const html = marked.parse(markdown) as string;
  return DOMPurify.sanitize(html);
};