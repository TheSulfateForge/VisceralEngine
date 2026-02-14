
import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Correct configuration for marked v15+
marked.use({ breaks: true, gfm: true, async: false });

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  // Using useMemo for synchronous parsing
  const html = useMemo(() => {
    try {
      const parsed = marked.parse(content);
      // Handle case where marked might return a promise despite config in some versions
      if (parsed instanceof Promise) {
          return "<span>Loading content...</span>";
      }
      return DOMPurify.sanitize(parsed as string);
    } catch (e) {
      console.error("Markdown parse error", e);
      return content;
    }
  }, [content]);

  return (
    <div 
      className="markdown-content" 
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
};
