/**
 * sanitizeDocumentHtml 单测。
 *
 * 覆盖：无 DOMParser 降级；有 DOMParser 时剥离危险标签/属性/协议。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeDocumentHtml } from './sanitizeDocumentHtml';

test('无 DOMParser 的运行时不会返回未净化 HTML', () => {
  const original = globalThis.DOMParser;
  // @ts-expect-error 测试强制走降级分支
  delete globalThis.DOMParser;
  try {
    assert.equal(
      sanitizeDocumentHtml('<img src=x onerror=alert(1)>'),
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  } finally {
    if (original) globalThis.DOMParser = original;
  }
});

test('DOMParser 路径剥离 script、危险属性与 protocol-relative URL', () => {
  const original = globalThis.DOMParser;

  class FakeAttr {
    constructor(
      public name: string,
      public value: string,
    ) {}
  }

  class FakeElement {
    attributes: FakeAttr[] = [];
    childNodes: FakeNode[] = [];
    parent: FakeElement | null = null;

    constructor(public tagName: string) {}

    setAttribute(name: string, value: string) {
      const existing = this.attributes.find((a) => a.name === name);
      if (existing) existing.value = value;
      else this.attributes.push(new FakeAttr(name, value));
    }

    removeAttribute(name: string) {
      this.attributes = this.attributes.filter((a) => a.name !== name);
    }

    remove() {
      if (!this.parent) return;
      this.parent.childNodes = this.parent.childNodes.filter((n) => n !== this);
      this.parent = null;
    }

    replaceWith(...nodes: FakeNode[]) {
      if (!this.parent) return;
      const index = this.parent.childNodes.indexOf(this);
      if (index < 0) return;
      this.parent.childNodes.splice(index, 1, ...nodes);
      for (const node of nodes) {
        if (node instanceof FakeElement) node.parent = this.parent;
      }
      this.parent = null;
    }
  }

  type FakeNode = FakeElement | { nodeType: 'text'; text: string };

  class FakeBody {
    childNodes: FakeNode[] = [];

    querySelectorAll(_selector: string): FakeElement[] {
      const result: FakeElement[] = [];
      const walk = (nodes: FakeNode[]) => {
        for (const node of nodes) {
          if (node instanceof FakeElement) {
            result.push(node);
            walk(node.childNodes);
          }
        }
      };
      walk(this.childNodes);
      return result;
    }

    get innerHTML(): string {
      const render = (nodes: FakeNode[]): string =>
        nodes
          .map((node) => {
            if (!(node instanceof FakeElement)) return node.text;
            const attrs = node.attributes
              .map((a) => ` ${a.name}="${a.value}"`)
              .join('');
            const children = render(node.childNodes);
            if (['br', 'hr', 'img'].includes(node.tagName.toLowerCase())) {
              return `<${node.tagName.toLowerCase()}${attrs}>`;
            }
            return `<${node.tagName.toLowerCase()}${attrs}>${children}</${node.tagName.toLowerCase()}>`;
          })
          .join('');
      return render(this.childNodes);
    }
  }

  /** 仅覆盖本测试用的 HTML 子集，避免引入 jsdom 依赖。 */
  class FakeDOMParser {
    parseFromString(html: string, _type: string) {
      const body = new FakeBody();
      const p = new FakeElement('P');
      p.childNodes.push({ nodeType: 'text', text: 'safe ' });

      const script = new FakeElement('SCRIPT');
      script.childNodes.push({ nodeType: 'text', text: 'alert(1)' });
      script.parent = p;
      p.childNodes.push(script);

      const img = new FakeElement('IMG');
      img.setAttribute('src', '//evil.example/x.png');
      img.setAttribute('onerror', 'alert(1)');
      img.parent = p;
      p.childNodes.push(img);

      const link = new FakeElement('A');
      link.setAttribute('href', 'https://example.com');
      link.childNodes.push({ nodeType: 'text', text: 'ok' });
      link.parent = p;
      p.childNodes.push(link);

      p.parent = body as unknown as FakeElement;
      body.childNodes.push(p);

      void html;
      return { body };
    }
  }

  globalThis.DOMParser = FakeDOMParser as unknown as typeof DOMParser;
  try {
    const result = sanitizeDocumentHtml(
      '<p>safe <script>alert(1)</script><img src="//evil.example/x.png" onerror=alert(1)><a href="https://example.com">ok</a></p>',
    );
    assert.equal(result.includes('script'), false);
    assert.equal(result.includes('onerror'), false);
    assert.equal(result.includes('//evil.example'), false);
    assert.equal(result.includes('href="https://example.com"'), true);
    assert.equal(result.includes('rel="noopener noreferrer"'), true);
  } finally {
    if (original) globalThis.DOMParser = original;
    else {
      // @ts-expect-error 清理测试注入
      delete globalThis.DOMParser;
    }
  }
});
