import { describe, expect, it } from 'vitest'
import { resolveImagePaths, restoreImagePaths } from '../../../src/main/documents/image-paths'

describe('image path conversion', () => {
  it('round-trips a relative image path without leaking file URLs', () => {
    const source = '![x](./img/a.png)'
    const shown = resolveImagePaths(source, '/work/spec.md')

    expect(shown).toContain('file://')
    expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
  })

  it('round-trips image paths containing spaces', () => {
    const source = '![diagram](<./img/a diagram.png>)'
    const shown = resolveImagePaths(source, '/work/spec.md')

    expect(shown).toContain('a%20diagram.png')
    expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
  })

  it('resolves and restores raw HTML image sources', () => {
    const source = '<img alt="x" src="./img/a.png">'
    const shown = resolveImagePaths(source, '/work/spec.md')

    expect(shown).toContain('src="file://')
    expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
  })

  it('leaves remote and data image URLs unchanged', () => {
    const source = '![remote](https://example.com/a.png)\n<img src="data:image/png;base64,AA==">'

    expect(resolveImagePaths(source, '/work/spec.md')).toBe(source)
  })
})

  it('round-trips Markdown image destinations without corrupting titles or syntax', () => {
    const cases = [
      '![title](./img/a.png "Caption")',
      '![spaces](<./img/a diagram.png> "Caption")',
      ['![nested](./img/a_(draft).png)', '![nested](./img/a_\\(draft\\).png)'],
      '![angle](<./img/a(draft).png>)',
      '<img alt="raw" src="./img/a (draft).png">',
      '![remote](https://example.com/a_(draft).png "Remote")',
      '![explicit](./img/a.png)',
    ]

    for (const entry of cases) {
      const [source, expected] = Array.isArray(entry) ? entry : [entry, entry]
      expect(restoreImagePaths(resolveImagePaths(source, '/work/spec.md'), '/work/spec.md')).toBe(expected)
    }
  })

it('handles escaped Markdown destinations, decoded file URL spaces, and empty destinations', () => {
  expect(resolveImagePaths('![empty]()', '/work/spec.md')).toBe('![empty]()')
  expect(restoreImagePaths('![empty]()', '/work/spec.md')).toBe('![empty]()')

  const escaped = '![escaped](./img/a_\\(draft\\).png "Caption")'
  const shown = resolveImagePaths(escaped, '/work/spec.md')
  expect(shown).toBe('![escaped](file:///work/img/a_(draft).png "Caption")')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(escaped)

  expect(restoreImagePaths(
    '![milkdown](file:///work/img/a_%5C(draft%5C).png "Caption")',
    '/work/spec.md',
  )).toBe('![milkdown](./img/a_\\\\\\(draft\\\\\\).png "Caption")')

  expect(restoreImagePaths(
    '![spaces](file:///work/img/a%20diagram.png "Caption")',
    '/work/spec.md',
  )).toBe('![spaces](<./img/a diagram.png> "Caption")')
})

it('preserves literal filename backslashes and safely serializes angle-closing characters', () => {
  expect(restoreImagePaths(
    '![literal](file:///work/img/a%5Cb.png "Literal")',
    '/work/spec.md',
  )).toBe('![literal](./img/a\\\\b.png "Literal")')

  const angle = '![greater](<./img/a\\>b.png> "Caption")'
  expect(restoreImagePaths(resolveImagePaths(angle, '/work/spec.md'), '/work/spec.md')).toBe(angle)
})

it('losslessly distinguishes literal backslashes from Markdown delimiter escapes', () => {
  const literalAngle = '![literal-angle](<./img/a\\\\\\>b.png> "Angle")'
  expect(restoreImagePaths(resolveImagePaths(literalAngle, '/work/spec.md'), '/work/spec.md')).toBe(literalAngle)

  const literalParen = '![literal-paren](./img/a\\\\\\(b\\).png "Paren")'
  expect(restoreImagePaths(resolveImagePaths(literalParen, '/work/spec.md'), '/work/spec.md')).toBe(literalParen)

  const escapedDelimiter = '![escaped](./img/a_\\(draft\\).png "Escaped")'
  expect(resolveImagePaths(escapedDelimiter, '/work/spec.md')).toBe(
    '![escaped](file:///work/img/a_(draft).png "Escaped")',
  )
  expect(restoreImagePaths(
    '![literal-url](file:///work/img/a_%5C(draft%5C).png "Literal URL")',
    '/work/spec.md',
  )).toBe('![literal-url](./img/a_\\\\\\(draft\\\\\\).png "Literal URL")')

  const rawHtml = '<img src="./img/a\\>(b).png" alt="raw">'
  expect(restoreImagePaths(resolveImagePaths(rawHtml, '/work/spec.md'), '/work/spec.md')).toBe(rawHtml)
})

it('canonically escapes literal angle delimiters and backslashes in angle destinations', () => {
  const source = '![angles](<./img/a\\<b\\> c.png> "Caption")'
  const shown = resolveImagePaths(source, '/work/spec.md')
  expect(shown).toContain('file:///work/img/a%3Cb%3E%20c.png')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

describe('protected Markdown ranges', () => {
  it('preserves exact fenced-code bytes while rewriting real images outside', () => {
    const source = [
      '![before](./img/before.png)',
      '````ts meta',
      '![fenced](./img/fenced.png)',
      '<img src="./img/fenced-html.png">',
      '```',
      '````',
      '~~~~ custom',
      '![tilde](./img/tilde.png)',
      '<img src="./img/tilde-html.png">',
      '~~~',
      '~~~~',
      '![after](./img/after.png)',
    ].join('\n')

    const shown = resolveImagePaths(source, '/work/spec.md')
    const fencedBackticks = source.slice(source.indexOf('````ts'), source.indexOf('![after]'))

    expect(shown.slice(shown.indexOf('````ts'), shown.indexOf('![after]'))).toBe(fencedBackticks)
    expect(shown).toContain('![before](file:///work/img/before.png)')
    expect(shown).toContain('![after](file:///work/img/after.png)')
    expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
  })

  it('preserves exact indented-code and variable inline-code bytes', () => {
    const source = [
      '    ![indented](./img/indented.png)',
      '\t<img src="./img/tabbed.png">',
      'Real ![outside](./img/outside.png)',
      '`![inline](./img/inline.png)` and ``<img src="./img/inline-html.png"> ` tick``',
      'Real <img src="./img/outside-html.png">',
    ].join('\r\n')

    const shown = resolveImagePaths(source, '/work/spec.md')

    expect(shown).toContain('    ![indented](./img/indented.png)\r\n')
    expect(shown).toContain('\t<img src="./img/tabbed.png">\r\n')
    expect(shown).toContain('`![inline](./img/inline.png)`')
    expect(shown).toContain('``<img src="./img/inline-html.png"> ` tick``')
    expect(shown).toContain('![outside](file:///work/img/outside.png)')
    expect(shown).toContain('<img src="file:///work/img/outside-html.png">')
    expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
  })

  it('does not patch protected ranges after restoring surrounding file URLs', () => {
    const source = [
      '![real](file:///work/img/real.png)',
      '```markdown',
      '![literal](file:///work/img/literal.png)',
      '<img src="file:///work/img/literal-html.png">',
      '```',
      'Inline `![literal](file:///work/img/inline.png)`',
      '',
      '    <img src="file:///work/img/indented.png">',
    ].join('\n')

    const restored = restoreImagePaths(source, '/work/spec.md')

    expect(restored).toBe(source.replace('![real](file:///work/img/real.png)', '![real](./img/real.png)'))
  })
})

describe('local image URL classification', () => {
  it('leaves protocol-relative and every explicit non-file URI scheme unchanged', () => {
    const references = [
      '//cdn.example.com/a.png',
      'https://example.com/a.png',
      'http://example.com/a.png',
      'data:image/png;base64,AA==',
      'blob:https://example.com/id',
      'ftp://example.com/a.png',
      'custom:asset/a.png',
    ]
    const source = references.flatMap((reference, index) => [
      `![m${index}](${reference})`,
      `<img src="${reference}">`,
    ]).join('\n')

    expect(resolveImagePaths(source, '/work/spec.md')).toBe(source)
    expect(restoreImagePaths(source, '/work/spec.md')).toBe(source)
  })

  it('continues to resolve relative, absolute, and Windows-drive-looking paths as local', () => {
    const source = [
      '![relative](./img/a.png)',
      '![absolute](/assets/a.png)',
      '![windows](C:\\images\\a.png)',
    ].join('\n')

    const shown = resolveImagePaths(source, '/work/spec.md')

    expect(shown).toContain('![relative](file:///work/img/a.png)')
    expect(shown).toContain('![absolute](file:///assets/a.png)')
    expect(shown).toMatch(/!\[windows\]\(file:/)
  })
})

it('preserves code ranges adjacent to other syntax and honors exact fence rules', () => {
  const source = [
    '- item `![inline](./img/inline.png)` and ![real](./img/real.png)',
    '',
    '   ```js',
    '   ![three-space-fence](./img/fenced.png)',
    '   ```',
    '',
    '    ```not-a-fence',
    '    ![indented](./img/indented.png)',
    '~~~ lang',
    '![tilde](./img/tilde.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('`![inline](./img/inline.png)` and ![real](file:///work/img/real.png)')
  expect(shown).toContain('![three-space-fence](./img/fenced.png)')
  expect(shown).toContain('    ![indented](./img/indented.png)')
  expect(shown).toContain('![tilde](./img/tilde.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('does not classify URI-like relative names or Windows drives as remote schemes', () => {
  const source = [
    '![dot-colon](./custom:asset.png)',
    '![windows-forward](C:/images/a.png)',
    '![windows-back](C:\\images\\a.png)',
    '![windows-relative](C:images\\a.png)',
    '![windows-drive-relative](C:asset.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).not.toBe(source)
  expect(shown.match(/file:/g)).toHaveLength(5)
})

it('protects inline code whose content ends with a backslash before the closer', () => {
  const protectedLiteral = '`![literal](./img/literal.png)\\`'
  const source = `${protectedLiteral} after ![real](./img/real.png)`

  expect([...protectedLiteral.slice(-2)]).toEqual(['\\', '`'])

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain(protectedLiteral)
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('does not treat a backslash-escaped backtick as inline code', () => {
  const source = String.raw`Before \`![literal](./img/literal.png)\` after ![real](./img/real.png)`

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain(String.raw`\`![literal](file:///work/img/literal.png)\``)
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('preserves fenced code inside blockquote and list containers', () => {
  const source = [
    '> ```js',
    '> ![quoted](./img/quoted.png)',
    '> <img src="./img/quoted-html.png">',
    '> ```',
    '- ```ts',
    '  ![listed](./img/listed.png)',
    '  <img src="./img/listed-html.png">',
    '  ```',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe(source.replace('./img/real.png', 'file:///work/img/real.png'))
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('preserves indented code inside blockquote and list containers', () => {
  const source = [
    '>     ![quoted](./img/quoted.png)',
    '>     <img src="./img/quoted-html.png">',
    '-     ![listed](./img/listed.png)',
    '      <img src="./img/listed-html.png">',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe(source.replace('./img/real.png', 'file:///work/img/real.png'))
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('rewrites an image destination when only its label contains a code span', () => {
  const source = '![`icon`](./img/icon.png)'

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe('![`icon`](file:///work/img/icon.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('still preserves a complete image literal inside a code span', () => {
  const source = '`![icon](./img/icon.png)` and ![real](./img/real.png)'

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe('`![icon](./img/icon.png)` and ![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('rewrites backticks in an image destination because they are not inline code', () => {
  const source = '![literal](`./img/literal.png`) and ![`icon`](./img/real.png)'

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe(
    '![literal](file:///work/%60./img/literal.png%60) and ![`icon`](file:///work/img/real.png)',
  )
})

it('rewrites a four-space list continuation image instead of treating it as code', () => {
  const source = [
    '- item',
    '    ![continuation](./img/continuation.png)',
    '    <img src="./img/continuation-html.png">',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('![continuation](file:///work/img/continuation.png)')
  expect(shown).toContain('<img src="file:///work/img/continuation-html.png">')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('protects list code indented four columns beyond the list content column', () => {
  const source = [
    '- item',
    '',
    '        ![eight-space-code](./img/eight.png)',
    '        <img src="./img/eight-html.png">',
    '-     ![marker-code](./img/marker.png)',
    '      <img src="./img/marker-html.png">',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe(source.replace('./img/real.png', 'file:///work/img/real.png'))
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('uses tab-expanded CommonMark list content columns for continuations and code', () => {
  const source = [
    '-   item',
    '      ![six-column-continuation](./img/six.png)',
    '',
    '        ![eight-column-code](./img/eight.png)',
    '-\titem',
    '\t![tab-continuation](./img/tab.png)',
    '',
    '\t\t![tab-code](./img/tab-code.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('![six-column-continuation](file:///work/img/six.png)')
  expect(shown).toContain('        ![eight-column-code](./img/eight.png)')
  expect(shown).toContain('\t![tab-continuation](file:///work/img/tab.png)')
  expect(shown).toContain('\t\t![tab-code](./img/tab-code.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('tracks nested list content-column stacks including blockquotes', () => {
  const source = [
    '- outer',
    '    -   inner',
    '          ![nested-continuation](./img/nested.png)',
    '',
    '            ![nested-code](./img/nested-code.png)',
    '> - outer',
    '>     - inner',
    '>         ![quoted-continuation](./img/quoted.png)',
    '>',
    '>             ![quoted-code](./img/quoted-code.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('![nested-continuation](file:///work/img/nested.png)')
  expect(shown).toContain('            ![nested-code](./img/nested-code.png)')
  expect(shown).toContain('![quoted-continuation](file:///work/img/quoted.png)')
  expect(shown).toContain('>             ![quoted-code](./img/quoted-code.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('closes a fenced code block whose list continuation prefix uses a tab', () => {
  const source = [
    '-\t```js',
    '\t![literal](./img/literal.png)',
    '\t```',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe(source.replace('./img/real.png', 'file:///work/img/real.png'))
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('uses tab overshoot as the base column for a nested list', () => {
  const source = [
    '- outer',
    '\t- inner',
    '\t  ![nested-continuation](./img/continuation.png)',
    '',
    '\t\t  ![nested-code](./img/code.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('\t  ![nested-continuation](file:///work/img/continuation.png)')
  expect(shown).toContain('\t\t  ![nested-code](./img/code.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('does not inherit a quote list stack after leaving and re-entering the quote', () => {
  const source = [
    '> - item',
    '>     continuation',
    'outside paragraph',
    '',
    '>',
    '>     ![reentered-code](./img/code.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('>     ![reentered-code](./img/code.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('clears list context when a non-list paragraph ends the container', () => {
  const source = [
    '- item',
    '# outside heading',
    '',
    '    ![root-code](./img/root-code.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('    ![root-code](./img/root-code.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('carries tab overshoot into list code classification', () => {
  const source = [
    '- item',
    '',
    '\t\t![literal](./img/literal.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('\t\t![literal](./img/literal.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('uses CommonMark tab expansion for a list fence closer', () => {
  const source = [
    '- item',
    '  ```js',
    '  ![literal](./img/literal.png)',
    '\t  ```',
    '![still-literal](./img/still.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('![literal](./img/literal.png)')
  expect(shown).toContain('![still-literal](file:///work/img/still.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('accepts a tab-aligned list fence closer and transforms following content', () => {
  const source = [
    '- item',
    '  ```js',
    '  ![literal](./img/literal.png)',
    '\t```',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toBe(source.replace('./img/real.png', 'file:///work/img/real.png'))
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('ends a root list when entering a sibling quote and protects later root code', () => {
  const source = [
    '- item',
    '> sibling quote',
    '',
    '    ![root-code](./img/root-code.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('    ![root-code](./img/root-code.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('retains a parent list when a nested quote starts at valid continuation indentation', () => {
  const source = [
    '- item',
    '  > nested quote',
    '  > continuation',
    '',
    '      ![list-code](./img/list-code.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('      ![list-code](./img/list-code.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('rewrites a quoted-list continuation after entering a nested quote', () => {
  const source = [
    '> - item',
    '>   > nested quote',
    '>     ![continuation](./img/continuation.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('>     ![continuation](file:///work/img/continuation.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('protects root code after a same-depth sibling quote ends a quoted list', () => {
  const source = [
    '> - item',
    '>   > nested quote',
    '> > sibling quote',
    '>',
    '>     ![root-code](./img/code.png)',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('>     ![root-code](./img/code.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('uses tab stops from parent columns for list fences and continuations', () => {
  const source = [
    '- item',
    '  \t![continuation](./img/continuation.png)',
    '  \t```',
    '  \t![literal](./img/literal.png)',
    '  \t```',
    '![real](./img/real.png)',
  ].join('\n')

  const shown = resolveImagePaths(source, '/work/spec.md')

  expect(shown).toContain('  \t![continuation](file:///work/img/continuation.png)')
  expect(shown).toContain('  \t![literal](./img/literal.png)')
  expect(shown).toContain('![real](file:///work/img/real.png)')
  expect(restoreImagePaths(shown, '/work/spec.md')).toBe(source)
})

it('returns multi-megabyte Markdown without image candidates before building an AST', () => {
  const content = '# Large\n```mermaid\ngraph TD; A[Draft] --> B[Review]\n```\n'.repeat(100_000)
  const started = performance.now()
  expect(restoreImagePaths(content, '/work/large.md')).toBe(content)
  expect(resolveImagePaths(content, '/work/large.md')).toBe(content)
  expect(performance.now() - started).toBeLessThan(1_000)
})
