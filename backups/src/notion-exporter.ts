import { FileSystem, Logger } from './types.js';
import { NotionClient, NotionObject } from './notion.js';
import { sanitizeFilename } from './utils.js';

export class NotionExporter {
  private readonly titleMap = new Map<string, string>();
  private readonly typeMap = new Map<string, 'page' | 'database'>();
  private readonly parentMap = new Map<string, string | null>();

  constructor(
    private readonly client: NotionClient,
    private readonly fs: FileSystem,
    private readonly logger: Logger
  ) {}

  async discoverObjects(): Promise<NotionObject[]> {
    const objects: NotionObject[] = [];

    for await (const raw of this.client.searchAll()) {
      const object = this.toNotionObject(raw);
      objects.push(object);
      this.titleMap.set(object.id, object.title);
      this.typeMap.set(object.id, object.object);
      this.parentMap.set(object.id, object.parentId);
    }

    return objects;
  }

  getParentPath(id: string): string {
    const visited = new Set<string>();
    const parts: string[] = [];
    let current = this.parentMap.get(id) ?? null;

    while (current && this.typeMap.has(current)) {
      if (visited.has(current)) break;
      visited.add(current);

      const title = sanitizeFilename(this.titleMap.get(current) ?? 'Untitled');
      parts.unshift(title);
      current = this.parentMap.get(current) ?? null;
    }

    return parts.join('/');
  }

  async exportPage(pageId: string, title: string, outputFile: string): Promise<void> {
    const lines: string[] = [`# ${title}`, ''];
    lines.push(...(await this.convertBlocks(pageId, '', 0)));
    await this.fs.writeFile(outputFile, lines.join('\n'));
  }

  async exportDatabase(
    databaseId: string,
    title: string,
    outputFile: string
  ): Promise<void> {
    const dbInfo = await this.client.getDatabase(databaseId);
    const rows: Record<string, unknown>[] = [];
    for await (const row of this.client.queryDatabase(databaseId)) {
      rows.push(row);
    }

    const lines: string[] = [`# ${title}`, ''];

    const description = extractPlainText(dbInfo.description);
    if (description) {
      lines.push(description, '', '');
    }

    if (rows.length === 0) {
      lines.push('_No entries._');
    } else {
      const properties = Object.keys((dbInfo.properties as Record<string, unknown>) ?? {});
      for (const row of rows) {
        const entryTitle = extractTitle(row);
        lines.push('', `## ${entryTitle}`, '');
        for (const propName of properties) {
          const value = getPropertyValue(
            ((row as Record<string, unknown>).properties as Record<string, unknown>)?.[propName]
          );
          lines.push(`- **${propName}**: ${value}`);
        }
      }
    }

    await this.fs.writeFile(outputFile, lines.join('\n'));
  }

  async uniqueFilePath(dir: string, base: string, ext: string): Promise<string> {
    const exists = async (p: string) => this.fs.exists(p);
    const candidate = `${dir}/${base}${ext}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
    let counter = 1;
    while (await exists(`${dir}/${base}_${counter}${ext}`)) {
      counter++;
    }
    return `${dir}/${base}_${counter}${ext}`;
  }

  private toNotionObject(raw: Record<string, unknown>): NotionObject {
    const id = String(raw.id);
    const object = String(raw.object) as 'page' | 'database';
    const parent = (raw.parent as Record<string, unknown>) ?? {};
    const parentId =
      String(parent.page_id ?? parent.database_id ?? parent.block_id ?? '') || null;

    let title = 'Untitled';
    if (object === 'page') {
      const properties = (raw.properties as Record<string, unknown>) ?? {};
      for (const value of Object.values(properties)) {
        const typed = value as Record<string, unknown>;
        if (typed.type === 'title') {
          const titleItems = (typed.title as Array<Record<string, unknown>>) ?? [];
          const text = titleItems.map((t) => String(t.plain_text ?? '')).join('');
          if (text) {
            title = text;
            break;
          }
        }
      }
    } else {
      const titleItems = (raw.title as Array<Record<string, unknown>>) ?? [];
      const text = titleItems.map((t) => String(t.plain_text ?? '')).join('');
      if (text) title = text;
    }

    return { id, object, title, parentId };
  }

  private async convertBlocks(blockId: string, indent: string, depth: number): Promise<string[]> {
    if (depth > 10) return [];

    const lines: string[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.getBlockChildren(blockId, cursor);
      const results = Array.isArray(response.results) ? response.results : [];

      for (const raw of results) {
        const block = raw as Record<string, unknown>;
        lines.push(...this.blockToMarkdown(block, indent));

        if (block.has_children === true) {
          const childId = String(block.id);
          const type = String(block.type);
          let childIndent = indent;
          if (
            type === 'bulleted_list_item' ||
            type === 'numbered_list_item' ||
            type === 'to_do' ||
            type === 'quote' ||
            type === 'callout'
          ) {
            childIndent = `${indent}  `;
          }
          lines.push(...(await this.convertBlocks(childId, childIndent, depth + 1)));
        }
      }

      cursor = response.next_cursor as string | undefined;
    } while (cursor);

    return lines;
  }

  private blockToMarkdown(block: Record<string, unknown>, indent: string): string[] {
    const type = String(block.type);

    switch (type) {
      case 'paragraph': {
        const text = richTextToMarkdown(block.paragraph as Record<string, unknown>);
        return text ? text.split('\n').map((line) => `${indent}${line}`) : [];
      }
      case 'heading_1':
        return [`${indent}# ${richTextToMarkdown(block.heading_1 as Record<string, unknown>)}`];
      case 'heading_2':
        return [`${indent}## ${richTextToMarkdown(block.heading_2 as Record<string, unknown>)}`];
      case 'heading_3':
        return [`${indent}### ${richTextToMarkdown(block.heading_3 as Record<string, unknown>)}`];
      case 'bulleted_list_item':
        return [
          `${indent}- ${richTextToMarkdown(block.bulleted_list_item as Record<string, unknown>)}`,
        ];
      case 'numbered_list_item':
        return [
          `${indent}1. ${richTextToMarkdown(block.numbered_list_item as Record<string, unknown>)}`,
        ];
      case 'to_do': {
        const checked = (block.to_do as Record<string, unknown>)?.checked === true;
        return [
          `${indent}- [${checked ? 'x' : ' '}] ${richTextToMarkdown(block.to_do as Record<string, unknown>)}`,
        ];
      }
      case 'code': {
        const code = block.code as Record<string, unknown>;
        const language = String(code?.language ?? '');
        const text = richTextToMarkdown(code);
        return [`${indent}\`\`\`${language}`, ...text.split('\n').map((line) => `${indent}${line}`), `${indent}\`\`\``];
      }
      case 'quote': {
        const text = richTextToMarkdown(block.quote as Record<string, unknown>);
        return text.split('\n').map((line) => `${indent}> ${line}`);
      }
      case 'divider':
        return [`${indent}---`];
      case 'callout': {
        const callout = block.callout as Record<string, unknown>;
        const text = richTextToMarkdown(callout);
        const result = text.split('\n').map((line) => `${indent}> ${line}`);
        const icon = callout?.icon as Record<string, unknown> | undefined;
        if (icon) {
          const iconText = String(icon.emoji ?? icon.type ?? '');
          if (iconText) {
            result.push(`${indent}> _(icon: ${iconText})_`);
          }
        }
        return result;
      }
      case 'toggle':
        return [];
      case 'child_page':
        return [`${indent}*Child page: ${String((block.child_page as Record<string, unknown>)?.title ?? block.id)}*`];
      case 'child_database':
        return [`${indent}*Child database: ${String((block.child_database as Record<string, unknown>)?.title ?? block.id)}*`];
      case 'link_to_page': {
        const link = block.link_to_page as Record<string, unknown>;
        if (link?.type === 'page_id') return [`${indent}*Linked page: ${String(link.page_id)}*`];
        if (link?.type === 'database_id') return [`${indent}*Linked database: ${String(link.database_id)}*`];
        return [`${indent}*Linked page*`];
      }
      case 'bookmark':
        return [`${indent}*Bookmark: ${String((block.bookmark as Record<string, unknown>)?.url ?? '')}*`];
      case 'image': {
        const image = block.image as Record<string, unknown>;
        const caption = richTextToMarkdown(image);
        if (image?.type === 'external') {
          const url = String((image.external as Record<string, unknown>)?.url ?? '');
          return [`${indent}![${caption}](${url})`];
        }
        if (image?.type === 'file') {
          return [`${indent}*Image: ${String((image.file as Record<string, unknown>)?.url ?? '')}*`];
        }
        return [`${indent}*Image*`];
      }
      default:
        return [`${indent}<!-- unsupported block type: ${type} -->`];
    }
  }
}

function richTextToMarkdown(container: Record<string, unknown> | undefined): string {
  if (!container) return '';
  const items = (container.rich_text as Array<Record<string, unknown>>) ?? [];
  if (items.length === 0 && container.type === 'image') {
    const caption = (container.caption as Array<Record<string, unknown>>) ?? [];
    return caption.map((item) => formatRichText(item)).join('');
  }
  return items.map((item) => formatRichText(item)).join('');
}

function formatRichText(item: Record<string, unknown>): string {
  const annotations = (item.annotations as Record<string, boolean>) ?? {};
  const text = String(item.plain_text ?? '');
  const href = item.href as string | undefined;

  let result = text;
  if (href) result = `[${result}](${href})`;
  if (annotations.code) result = `\`${result}\``;
  if (annotations.strikethrough) result = `~~${result}~~`;
  if (annotations.italic) result = `*${result}*`;
  if (annotations.bold) result = `**${result}**`;

  return result;
}

function extractPlainText(items: unknown): string {
  if (!Array.isArray(items)) return '';
  return items.map((item) => String((item as Record<string, unknown>).plain_text ?? '')).join('');
}

function extractTitle(row: Record<string, unknown>): string {
  const properties = (row.properties as Record<string, unknown>) ?? {};
  for (const value of Object.values(properties)) {
    const typed = value as Record<string, unknown>;
    if (typed.type === 'title') {
      const titleItems = (typed.title as Array<Record<string, unknown>>) ?? [];
      const text = titleItems.map((t) => String(t.plain_text ?? '')).join('');
      if (text) return text;
    }
  }
  return 'Untitled';
}

function getPropertyValue(property: unknown): string {
  if (property === null || property === undefined) return '';
  const prop = property as Record<string, unknown>;

  switch (prop.type) {
    case 'title':
      return ((prop.title as Array<Record<string, unknown>>) ?? [])
        .map((t) => String(t.plain_text ?? ''))
        .join('');
    case 'rich_text':
      return ((prop.rich_text as Array<Record<string, unknown>>) ?? [])
        .map((t) => String(t.plain_text ?? ''))
        .join('');
    case 'number':
      return prop.number === null ? '' : String(prop.number);
    case 'select':
      return String((prop.select as Record<string, unknown>)?.name ?? '');
    case 'multi_select':
      return ((prop.multi_select as Array<Record<string, unknown>>) ?? [])
        .map((s) => String(s.name ?? ''))
        .join('; ');
    case 'status':
      return String((prop.status as Record<string, unknown>)?.name ?? '');
    case 'date': {
      const date = prop.date as Record<string, unknown> | undefined;
      if (!date) return '';
      let value = String(date.start ?? '');
      if (date.end) value += ` to ${String(date.end)}`;
      return value;
    }
    case 'formula': {
      const formula = prop.formula as Record<string, unknown> | undefined;
      if (!formula) return '';
      if (formula.type === 'string') return String(formula.string ?? '');
      if (formula.type === 'number') return String(formula.number ?? '');
      if (formula.type === 'boolean') return String(formula.boolean ?? false);
      if (formula.type === 'date') return String((formula.date as Record<string, unknown>)?.start ?? '');
      return '';
    }
    case 'relation':
      return ((prop.relation as Array<Record<string, unknown>>) ?? [])
        .map((r) => String(r.id ?? ''))
        .join('; ');
    case 'rollup':
      return (
        ((prop.rollup as Record<string, unknown>)?.array as Array<Record<string, unknown>>)
          ?.map((r) => getPropertyValue(r))
          .join('; ') ?? ''
      );
    case 'people':
      return ((prop.people as Array<Record<string, unknown>>) ?? [])
        .map((p) => String(p.name ?? p.id ?? ''))
        .join('; ');
    case 'files':
      return ((prop.files as Array<Record<string, unknown>>) ?? [])
        .map((f) =>
          String(
            f.name ?? (f.file as Record<string, unknown>)?.url ?? (f.external as Record<string, unknown>)?.url ?? ''
          )
        )
        .join('; ');
    case 'checkbox':
      return String(prop.checkbox ?? false);
    case 'url':
      return String(prop.url ?? '');
    case 'email':
      return String(prop.email ?? '');
    case 'phone_number':
      return String(prop.phone_number ?? '');
    case 'created_by':
      return String((prop.created_by as Record<string, unknown>)?.name ?? (prop.created_by as Record<string, unknown>)?.id ?? '');
    case 'created_time':
      return String(prop.created_time ?? '');
    case 'last_edited_by':
      return String(
        (prop.last_edited_by as Record<string, unknown>)?.name ?? (prop.last_edited_by as Record<string, unknown>)?.id ?? ''
      );
    case 'last_edited_time':
      return String(prop.last_edited_time ?? '');
    default:
      return JSON.stringify(prop);
  }
}

export { extractPlainText, extractTitle, getPropertyValue, richTextToMarkdown, formatRichText };
