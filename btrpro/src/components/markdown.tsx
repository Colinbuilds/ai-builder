// Tiny, safe renderer for AI text: "## " headings, "- " bullets, pipe tables, **bold**, paragraphs. No HTML passthrough.
export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  let table: string[] = [];
  const flushList = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length} className="mb-2 list-disc pl-5">
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  const flushTable = () => {
    if (table.length) {
      const rows = table
        .filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r))
        .map((r) =>
          r
            .replace(/^\s*\|/, "")
            .replace(/\|\s*$/, "")
            .split("|")
            .map((c) => c.trim()),
        );
      const [head, ...body] = rows;
      blocks.push(
        <div key={blocks.length} className="mb-2 overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th
                    key={i}
                    className="border px-2 py-1 text-left font-semibold"
                  >
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="border px-2 py-1 align-top">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    }
    table = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      table.push(line);
      continue;
    }
    flushTable();
    if (/^\s*[-*•]\s+/.test(line)) {
      list.push(line.replace(/^\s*[-*•]\s+/, ""));
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      h ? (
        <h3 key={blocks.length} className="mt-3 mb-1 font-semibold first:mt-0">
          {h[1]}
        </h3>
      ) : (
        <p key={blocks.length} className="mb-2">
          {inline(line)}
        </p>
      ),
    );
  }
  flushList();
  flushTable();
  return <div className="text-sm">{blocks}</div>;
}

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded bg-muted px-1 text-xs">
        {part.slice(1, -1)}
      </code>
    ) : part.length > 2 && part.startsWith("_") && part.endsWith("_") ? (
      <em key={i}>{part.slice(1, -1)}</em>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
